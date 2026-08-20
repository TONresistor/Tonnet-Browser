import { errorMessage } from '../../shared/errors'
import { webContents } from 'electron'
import { normalizePaymentOrigin } from './payment-policy'
import { getSetting } from '../settings'
import { X402_VERSION, DEFAULT_APPROVAL_TIMEOUT_S } from './constants'
import { ERROR_TRUNCATE_LENGTH } from '../../shared/constants'
import type { PaymentRequirements, PaymentNotificationData, WalletTransaction } from '../../shared/types'
import { createLogger } from '../../shared/logger'
import {
  buildPaymentNotification as buildNotification,
  fetchPaymentResource as sessionFetch,
  MAX_PAYMENT_RESPONSE_BYTES as MAX_RESPONSE_BODY,
  parsePaymentRequirements,
  readBoundedBody,
  resolveAutoPayMode,
  validatePaymentRequirements,
} from './payment-requirements'
import type { PaymentHistoryPort, PaymentPolicyPort, PaymentWalletPort } from './payment-ports'
import { XhrPaymentTokenStore } from './xhr-payment-tokens'
import type { InterceptedRequest, PaymentNotificationSink, PendingPaymentApproval } from './payment-interceptor-types'
import { sameWalletIdentity, type WalletIdentitySnapshot } from './wallet-identity'
import { registerPaymentSessionListener } from './payment-session-listener'
const log = createLogger('payment-interceptor')
export type { PaymentNotificationSink } from './payment-interceptor-types'
export class PaymentInterceptor {
  private walletManager: PaymentWalletPort
  private paymentPolicyStore: PaymentPolicyPort
  private walletHistoryManager: PaymentHistoryPort
  private notificationSink: PaymentNotificationSink
  private xhrTokens = new XhrPaymentTokenStore()
  private inflightXhrPayments = new Map<
    string,
    { promise: Promise<{ success: boolean; error?: string }>; count: number }
  >()
  private pendingApprovals = new Map<string, PendingPaymentApproval>()
  private accountGeneration = 0

  constructor(
    walletManager: PaymentWalletPort,
    paymentPolicyStore: PaymentPolicyPort,
    walletHistoryManager: PaymentHistoryPort,
    notificationSink: PaymentNotificationSink
  ) {
    this.walletManager = walletManager
    this.paymentPolicyStore = paymentPolicyStore
    this.walletHistoryManager = walletHistoryManager
    this.notificationSink = notificationSink
  }

  private emitPaymentNotification(notification: PaymentNotificationData): void {
    this.notificationSink(notification)
  }
  registerOnSession(session: Electron.Session): void {
    registerPaymentSessionListener(session, async (request) => {
      try {
        await this.handle402(request)
      } catch (error) {
        log.error('Error handling 402:', error)
      }
    })
  }
  private async handle402(request: InterceptedRequest): Promise<void> {
    const walletState = this.walletManager.getState()
    if (!walletState.isCreated) {
      log.warn('402 received but no wallet created, ignoring')
      return
    }
    const walletIdentity = this.walletManager.getIdentitySnapshot()
    if (!walletIdentity) return
    const accountGeneration = this.accountGeneration
    const session = request.session

    let response: Response
    try {
      response = await sessionFetch(session, request.url)
    } catch (err) {
      log.error('Failed to re-fetch 402 URL:', err)
      return
    }

    if (response.status !== 402) {
      log.warn(`Re-fetch returned ${response.status} instead of 402, skipping`)
      return
    }

    // Early-bail if Content-Length advertises oversize. Authoritative size check
    // happens during the stream read (header is attacker-controlled).
    const contentLength = parseInt(response.headers?.get?.('content-length') ?? '0', 10)
    if (contentLength > MAX_RESPONSE_BODY) {
      log.error(`402 response body too large: ${contentLength} bytes`)
      return
    }

    let paymentReq: PaymentRequirements
    try {
      paymentReq = await parsePaymentRequirements(response)
    } catch (err) {
      log.error('Failed to read or parse PaymentRequirements JSON:', err)
      return
    }

    const finalDomain = normalizePaymentOrigin(request.url)

    let originalDomain = request.originalOrigin ?? finalDomain
    try {
      const allWc = webContents.getAllWebContents()
      for (const wc of allWc) {
        if (wc.id === request.webContentsId) {
          const pageUrl = wc.getURL()
          if (pageUrl) {
            if (!request.originalOrigin) originalDomain = normalizePaymentOrigin(pageUrl)
          }
          break
        }
      }
    } catch {
      void 0
    }
    const isCrossDomain = finalDomain !== originalDomain
    const baseMode = isCrossDomain ? 'manual' : this.paymentPolicyStore.getSiteMode(originalDomain)
    const walletSettings = getSetting('wallet')
    const mode = resolveAutoPayMode(baseMode, paymentReq.amount, walletSettings.limits.perRequest)

    if (mode === 'off') {
      log.debug('Payment mode is off, ignoring 402')
      return
    }

    const validation = validatePaymentRequirements(paymentReq, {
      originalDomain,
      finalDomain,
      isAutoMode: mode === 'auto',
      walletState: this.walletManager.getState(),
      perRequestLimit: walletSettings.limits.perRequest,
    })

    if (!validation.valid) {
      log.warn(`PaymentRequirements validation failed: ${validation.reason}`)
      return
    }

    const reservationId = this.paymentPolicyStore.reservePayment(originalDomain, paymentReq.amount)
    if (!reservationId) {
      this.emitPaymentNotification(
        buildNotification(
          crypto.randomUUID(),
          originalDomain,
          request.url,
          paymentReq,
          'failed',
          'Spending limit reached'
        )
      )
      return
    }

    if (mode === 'auto') {
      await this.executePayment(request, paymentReq, originalDomain, walletIdentity, accountGeneration, reservationId)
    } else {
      const paymentId = crypto.randomUUID()

      const ttlTimeout = setTimeout(
        () => {
          const pending = this.pendingApprovals.get(paymentId)
          if (pending) {
            this.pendingApprovals.delete(paymentId)
            if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
            this.emitPaymentNotification(
              buildNotification(paymentId, originalDomain, request.url, paymentReq, 'rejected', 'Approval timed out')
            )
            log.event('info', 'payment.approval.timeout', 'payment approval timed out')
          }
        },
        (paymentReq.maxTimeoutSeconds || DEFAULT_APPROVAL_TIMEOUT_S) * 1_000
      )

      this.pendingApprovals.set(paymentId, {
        request,
        paymentReq,
        domain: originalDomain,
        walletIdentity,
        accountGeneration,
        ttl: ttlTimeout,
        reservationId,
      })

      this.emitPaymentNotification(buildNotification(paymentId, originalDomain, request.url, paymentReq, 'pending'))
    }
  }

  private async executePayment(
    request: InterceptedRequest,
    paymentReq: PaymentRequirements,
    domain: string,
    walletIdentity: WalletIdentitySnapshot,
    accountGeneration: number,
    reservationId?: string
  ): Promise<void> {
    const paymentId = crypto.randomUUID()
    const session = request.session

    try {
      const pendingTx: WalletTransaction = {
        id: paymentId,
        type: 'x402',
        amount: paymentReq.amount,
        address: paymentReq.payTo,
        timestamp: Date.now(),
        status: 'pending',
        x402Domain: domain,
        x402Url: request.url,
      }
      await this.walletHistoryManager.add(pendingTx)

      const payload = await this.walletManager.signX402Payment(paymentReq, walletIdentity)
      if (accountGeneration !== this.accountGeneration || !this.isCurrentIdentity(walletIdentity)) {
        throw new Error('Wallet changed before payment retry')
      }

      const xPaymentHeader = JSON.stringify({
        x402Version: X402_VERSION,
        payload,
      })
      // SECURITY: NEVER log xPaymentHeader

      // Retry through session with timeout
      // redirect: 'error' prevents the signed payment BOC (in X-PAYMENT) from
      // leaking to a different origin if the server issues a 3xx redirect.
      const retryResponse = await sessionFetch(session, request.url, {
        headers: { 'X-PAYMENT': xPaymentHeader },
        redirect: 'error',
      })

      if (retryResponse.ok) {
        if (reservationId) this.paymentPolicyStore.confirmPayment(reservationId)

        await this.walletHistoryManager.updateStatus(paymentId, 'confirmed')

        this.emitPaymentNotification(buildNotification(paymentId, domain, request.url, paymentReq, 'completed'))

        const allWebContents = webContents.getAllWebContents()
        for (const wc of allWebContents) {
          if (wc.id === request.webContentsId) {
            wc.loadURL(request.url, {
              extraHeaders: `X-PAYMENT: ${xPaymentHeader}`,
            })
            break
          }
        }

        log.event('info', 'payment.completed', 'HTTP 402 payment completed')
      } else {
        if (reservationId) this.paymentPolicyStore.rollbackPayment(reservationId)
        const errorText = await readBoundedBody(retryResponse, MAX_RESPONSE_BODY).catch(() => 'read error')
        await this.walletHistoryManager.updateStatus(paymentId, 'failed')

        this.emitPaymentNotification(
          buildNotification(
            paymentId,
            domain,
            request.url,
            paymentReq,
            'failed',
            `Server returned ${retryResponse.status}: ${errorText.slice(0, ERROR_TRUNCATE_LENGTH)}`
          )
        )

        log.event('warn', 'payment.retry.failed', 'payment retry failed', { status: retryResponse.status })
      }
    } catch (err) {
      if (reservationId) this.paymentPolicyStore.rollbackPayment(reservationId)
      await this.walletHistoryManager
        .updateStatus(paymentId, 'failed')
        .catch((err) => log.debug('Failed to update payment history status:', err))

      this.emitPaymentNotification(
        buildNotification(paymentId, domain, request.url, paymentReq, 'failed', errorMessage(err))
      )

      log.event('error', 'payment.execution.failed', 'payment execution failed', { error: err })
    }
  }

  async approvePayment(paymentId: string): Promise<void> {
    const pending = this.pendingApprovals.get(paymentId)
    if (!pending) {
      log.event('warn', 'payment.approval.missing', 'pending payment approval not found')
      return
    }

    clearTimeout(pending.ttl)
    this.pendingApprovals.delete(paymentId)

    if (!this.isCurrentIdentity(pending.walletIdentity)) {
      if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
      this.emitPaymentNotification(
        buildNotification(
          paymentId,
          pending.domain,
          pending.request.url,
          pending.paymentReq,
          'failed',
          'Wallet changed before approval'
        )
      )
      pending.xhrResolver?.({ success: false, error: 'wallet-changed' })
      return
    }

    if (pending.xhrResolver) {
      try {
        const payload = await this.walletManager.signX402Payment(pending.paymentReq, pending.walletIdentity)
        if (pending.accountGeneration !== this.accountGeneration || !this.isCurrentIdentity(pending.walletIdentity)) {
          throw new Error('Wallet changed before payment token registration')
        }
        const xPaymentHeader = JSON.stringify({ x402Version: X402_VERSION, payload })
        // SECURITY: NEVER log xPaymentHeader
        this.registerXhrPaymentToken(
          pending.request.webContentsId,
          pending.request.url,
          xPaymentHeader,
          pending.paymentReq.maxTimeoutSeconds * 1_000,
          pending.walletIdentity
        )
        if (pending.reservationId) this.paymentPolicyStore.confirmPayment(pending.reservationId)

        const tx: WalletTransaction = {
          id: paymentId,
          type: 'x402',
          amount: pending.paymentReq.amount,
          address: pending.paymentReq.payTo,
          timestamp: Date.now(),
          status: 'confirmed',
          x402Domain: pending.domain,
          x402Url: pending.request.url,
        }
        await this.walletHistoryManager.add(tx)

        this.emitPaymentNotification(
          buildNotification(paymentId, pending.domain, pending.request.url, pending.paymentReq, 'completed')
        )
        log.debug(`XHR payment approved for ${pending.domain}`)
        pending.xhrResolver({ success: true })
      } catch (err) {
        this.xhrTokens.revoke(pending.request.webContentsId, pending.request.url)
        if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
        this.emitPaymentNotification(
          buildNotification(
            paymentId,
            pending.domain,
            pending.request.url,
            pending.paymentReq,
            'failed',
            errorMessage(err)
          )
        )
        log.event('error', 'payment.xhr_manual.failed', 'manual XHR payment failed', { error: err })
        pending.xhrResolver({ success: false, error: errorMessage(err) })
      }
    } else {
      await this.executePayment(
        pending.request,
        pending.paymentReq,
        pending.domain,
        pending.walletIdentity,
        this.accountGeneration,
        pending.reservationId
      )
    }
  }

  rejectPayment(paymentId: string): void {
    const pending = this.pendingApprovals.get(paymentId)
    if (!pending) return

    clearTimeout(pending.ttl)
    this.pendingApprovals.delete(paymentId)
    if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)

    this.emitPaymentNotification(
      buildNotification(paymentId, pending.domain, pending.request.url, pending.paymentReq, 'rejected')
    )
    log.event('info', 'payment.rejected', 'HTTP 402 payment rejected')
    if (pending.xhrResolver) {
      pending.xhrResolver({ success: false, error: 'user-rejected' })
    }
  }

  registerXhrPaymentToken(
    webContentsId: number,
    url: string,
    xPaymentHeader: string,
    ttlMs: number,
    walletIdentity: WalletIdentitySnapshot,
    uses: number = 1
  ): void {
    this.xhrTokens.register(webContentsId, url, xPaymentHeader, ttlMs, walletIdentity, uses)
  }

  consumeXhrPaymentToken(webContentsId: number, url: string): string | null {
    return this.xhrTokens.consume(webContentsId, url, this.walletManager.getIdentitySnapshot())
  }
  async requestXhrPayment(webContentsId: number, url: string): Promise<{ success: boolean; error?: string }> {
    const key = `${webContentsId}|${url}`
    const existing = this.inflightXhrPayments.get(key)
    if (existing) {
      existing.count++
      return existing.promise
    }
    const entry: { promise: Promise<{ success: boolean; error?: string }>; count: number } = {
      promise: Promise.resolve({ success: false }),
      count: 1,
    }
    entry.promise = this._requestXhrPaymentInner(webContentsId, url, () => entry.count).finally(() =>
      this.inflightXhrPayments.delete(key)
    )
    this.inflightXhrPayments.set(key, entry)
    return entry.promise
  }

  private async _requestXhrPaymentInner(
    webContentsId: number,
    url: string,
    getUsesCount: () => number = () => 1
  ): Promise<{ success: boolean; error?: string }> {
    const walletState = this.walletManager.getState()
    if (!walletState.isCreated) {
      return { success: false, error: 'wallet-not-created' }
    }
    const walletIdentity = this.walletManager.getIdentitySnapshot()
    if (!walletIdentity) return { success: false, error: 'wallet-not-created' }
    const accountGeneration = this.accountGeneration

    const wc = webContents.fromId(webContentsId)
    if (!wc) {
      return { success: false, error: 'webcontents-not-found' }
    }

    const session = wc.session

    let response: Response
    try {
      response = await sessionFetch(session, url)
    } catch (err) {
      log.error('XHR payment: failed to fetch 402:', err)
      return { success: false, error: errorMessage(err) }
    }

    if (response.status !== 402) {
      log.debug(`XHR payment: fetch returned ${response.status} instead of 402`)
      return { success: false, error: 'fetch-no-402' }
    }

    let paymentReq: PaymentRequirements
    try {
      paymentReq = await parsePaymentRequirements(response)
    } catch (err) {
      log.error('XHR payment: failed to parse PaymentRequirements:', err)
      return { success: false, error: 'parse-error' }
    }

    let finalDomain: string
    let originalDomain: string
    try {
      finalDomain = normalizePaymentOrigin(url)
      originalDomain = finalDomain
    } catch {
      return { success: false, error: 'invalid-url' }
    }
    try {
      const pageUrl = wc.getURL()
      if (pageUrl) {
        originalDomain = normalizePaymentOrigin(pageUrl)
      }
    } catch {
      // fall back to finalDomain
    }

    const isCrossDomain = finalDomain !== originalDomain
    const baseMode = isCrossDomain ? 'manual' : this.paymentPolicyStore.getSiteMode(originalDomain)
    const walletSettings = getSetting('wallet')
    const mode = resolveAutoPayMode(baseMode, paymentReq.amount, walletSettings.limits.perRequest)

    if (mode === 'off') {
      return { success: false, error: 'policy-off' }
    }

    const validation = validatePaymentRequirements(paymentReq, {
      originalDomain,
      finalDomain,
      isAutoMode: mode === 'auto',
      walletState: this.walletManager.getState(),
      perRequestLimit: walletSettings.limits.perRequest,
    })
    if (!validation.valid) {
      log.warn(`XHR payment: validation failed: ${validation.reason}`)
      return { success: false, error: 'invalid-requirements' }
    }

    const reservationId = this.paymentPolicyStore.reservePayment(originalDomain, paymentReq.amount)
    if (!reservationId) {
      return { success: false, error: 'limit' }
    }

    if (mode === 'auto') {
      const paymentId = crypto.randomUUID()
      try {
        const payload = await this.walletManager.signX402Payment(paymentReq, walletIdentity)
        if (accountGeneration !== this.accountGeneration || !this.isCurrentIdentity(walletIdentity)) {
          throw new Error('Wallet changed before payment token registration')
        }
        const xPaymentHeader = JSON.stringify({ x402Version: X402_VERSION, payload })
        // SECURITY: NEVER log xPaymentHeader
        this.registerXhrPaymentToken(
          webContentsId,
          url,
          xPaymentHeader,
          paymentReq.maxTimeoutSeconds * 1_000,
          walletIdentity,
          getUsesCount()
        )
        this.paymentPolicyStore.confirmPayment(reservationId)

        const tx: WalletTransaction = {
          id: paymentId,
          type: 'x402',
          amount: paymentReq.amount,
          address: paymentReq.payTo,
          timestamp: Date.now(),
          status: 'confirmed',
          x402Domain: originalDomain,
          x402Url: url,
        }
        await this.walletHistoryManager.add(tx)

        this.emitPaymentNotification(buildNotification(paymentId, originalDomain, url, paymentReq, 'completed'))
        log.debug(`XHR payment signed for ${originalDomain}`)
        return { success: true }
      } catch (err) {
        this.xhrTokens.revoke(webContentsId, url)
        this.paymentPolicyStore.rollbackPayment(reservationId)
        log.event('error', 'payment.xhr_auto.failed', 'automatic XHR payment failed', { error: err })
        return { success: false, error: errorMessage(err) }
      }
    }

    const paymentId = crypto.randomUUID()
    return new Promise((resolve) => {
      const ttlTimeout = setTimeout(
        () => {
          const pending = this.pendingApprovals.get(paymentId)
          if (pending) {
            this.pendingApprovals.delete(paymentId)
            if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
            this.emitPaymentNotification(
              buildNotification(paymentId, originalDomain, url, paymentReq, 'rejected', 'Approval timed out')
            )
            log.debug(`XHR payment approval timed out for ${originalDomain}`)
            pending.xhrResolver?.({ success: false, error: 'timeout' })
          }
        },
        (paymentReq.maxTimeoutSeconds || DEFAULT_APPROVAL_TIMEOUT_S) * 1_000
      )

      this.pendingApprovals.set(paymentId, {
        request: { url, webContentsId, session },
        paymentReq,
        domain: originalDomain,
        walletIdentity,
        accountGeneration,
        ttl: ttlTimeout,
        reservationId,
        xhrResolver: resolve,
      })

      this.emitPaymentNotification(buildNotification(paymentId, originalDomain, url, paymentReq, 'pending'))
    })
  }

  destroy(): void {
    this.clearAccountState()
  }
  clearAccountState(): void {
    this.accountGeneration++
    for (const [, pending] of this.pendingApprovals) {
      clearTimeout(pending.ttl)
      if (pending.reservationId) {
        this.paymentPolicyStore.rollbackPayment(pending.reservationId)
      }
      pending.xhrResolver?.({ success: false, error: 'wallet-changed' })
    }
    this.pendingApprovals.clear()
    this.xhrTokens.clear()
    this.inflightXhrPayments.clear()
  }
  private isCurrentIdentity(expected: WalletIdentitySnapshot): boolean {
    return sameWalletIdentity(this.walletManager.getIdentitySnapshot(), expected)
  }
}
