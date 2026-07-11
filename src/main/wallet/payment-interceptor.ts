/**
 * HTTP 402 payment interceptor.
 * Registers on Electron sessions to intercept 402 responses,
 * validate PaymentRequirements, and handle auto/manual payment flows.
 */

import { errorMessage } from '../../shared/errors'
import { webContents } from 'electron'
import { normalizeToSecondLevel } from './payment-policy'
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
  /** Pending manual approval requests, keyed by payment ID */
  private pendingApprovals = new Map<string, PendingPaymentApproval>()

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
    session.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      if (details.resourceType !== 'mainFrame') return
      if (details.statusCode !== 402) return
      if (details.webContentsId == null) return

      const request: InterceptedRequest = {
        url: details.url,
        webContentsId: details.webContentsId,
        session,
      }

      this.handle402(request).catch((err) => {
        log.error('Error handling 402:', err)
      })
    })
  }

  private async handle402(request: InterceptedRequest): Promise<void> {
    const walletState = this.walletManager.getState()
    if (!walletState.isCreated) {
      log.warn('402 received but no wallet created, ignoring')
      return
    }

    const session = request.session

    // Re-fetch through session with timeout
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

    const finalDomain = normalizeToSecondLevel(new URL(request.url).hostname)

    // FIX 2: Use the page's actual URL (what the user navigated to) for cross-domain detection.
    // request.referrer is always empty due to privacy stripping.
    let originalDomain = finalDomain
    try {
      const allWc = webContents.getAllWebContents()
      for (const wc of allWc) {
        if (wc.id === request.webContentsId) {
          const pageUrl = wc.getURL()
          if (pageUrl) {
            originalDomain = normalizeToSecondLevel(new URL(pageUrl).hostname)
          }
          break
        }
      }
    } catch {
      // Fall back to finalDomain if webContents lookup fails
    }

    // Cross-domain redirect = force manual
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
      await this.executePayment(request, paymentReq, originalDomain, reservationId)
    } else {
      const paymentId = crypto.randomUUID()

      // FIX 6: Auto-reject pending approvals after TTL
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
    reservationId?: string
  ): Promise<void> {
    const paymentId = crypto.randomUUID()
    const session = request.session

    try {
      // Persist pending payment to history before sending
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

      // Sign BOC
      const payload = await this.walletManager.signX402Payment(paymentReq)

      // Build X-PAYMENT header (JSON.stringify, NOT base64)
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

        // Navigate the original webContents to reload with payment header
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

  /**
   * Approve a pending manual payment.
   * Called from IPC when the user clicks "Approve" in the renderer.
   */
  async approvePayment(paymentId: string): Promise<void> {
    const pending = this.pendingApprovals.get(paymentId)
    if (!pending) {
      log.event('warn', 'payment.approval.missing', 'pending payment approval not found')
      return
    }

    clearTimeout(pending.ttl)
    this.pendingApprovals.delete(paymentId)

    if (pending.xhrResolver) {
      try {
        const payload = await this.walletManager.signX402Payment(pending.paymentReq)
        const xPaymentHeader = JSON.stringify({ x402Version: X402_VERSION, payload })
        // SECURITY: NEVER log xPaymentHeader
        this.registerXhrPaymentToken(
          pending.request.webContentsId,
          pending.request.url,
          xPaymentHeader,
          pending.paymentReq.maxTimeoutSeconds * 1_000
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
      await this.executePayment(pending.request, pending.paymentReq, pending.domain, pending.reservationId)
    }
  }

  /**
   * Reject a pending manual payment.
   */
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

  /**
   * Store a signed X-PAYMENT token for a pending XHR retry.
   * Called by requestXhrPayment (auto) and approvePayment (manual XHR path).
   */
  registerXhrPaymentToken(
    webContentsId: number,
    url: string,
    xPaymentHeader: string,
    ttlMs: number,
    uses: number = 1
  ): void {
    this.xhrTokens.register(webContentsId, url, xPaymentHeader, ttlMs, uses)
  }

  /**
   * Retrieve and remove a stored XHR token for use in onBeforeSendHeaders.
   * Returns null if the key is missing or the token has expired.
   */
  consumeXhrPaymentToken(webContentsId: number, url: string): string | null {
    return this.xhrTokens.consume(webContentsId, url)
  }

  /**
   * Handle a 402 from an XHR request.
   * Signs and registers a token (auto mode) or prompts the user (manual mode).
   * Does NOT do wc.loadURL — the preload shim retries with the injected header.
   */
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
      finalDomain = normalizeToSecondLevel(new URL(url).hostname)
      originalDomain = finalDomain
    } catch {
      return { success: false, error: 'invalid-url' }
    }
    try {
      const pageUrl = wc.getURL()
      if (pageUrl) {
        originalDomain = normalizeToSecondLevel(new URL(pageUrl).hostname)
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
        const payload = await this.walletManager.signX402Payment(paymentReq)
        const xPaymentHeader = JSON.stringify({ x402Version: X402_VERSION, payload })
        // SECURITY: NEVER log xPaymentHeader
        this.registerXhrPaymentToken(
          webContentsId,
          url,
          xPaymentHeader,
          paymentReq.maxTimeoutSeconds * 1_000,
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
        ttl: ttlTimeout,
        reservationId,
        xhrResolver: resolve,
      })

      this.emitPaymentNotification(buildNotification(paymentId, originalDomain, url, paymentReq, 'pending'))
    })
  }

  /**
   * Clean up all pending approvals and their TTL timers.
   * Called on app exit via destroyServices().
   */
  destroy(): void {
    for (const [, pending] of this.pendingApprovals) {
      clearTimeout(pending.ttl)
      if (pending.reservationId) {
        this.paymentPolicyStore.rollbackPayment(pending.reservationId)
      }
    }
    this.pendingApprovals.clear()
    this.xhrTokens.clear()
  }
}

// Singleton removed: use ServiceRegistry from services.ts
