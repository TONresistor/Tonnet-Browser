/**
 * HTTP 402 payment interceptor.
 * Registers on Electron sessions to intercept 402 responses,
 * validate PaymentRequirements, and handle auto/manual payment flows.
 */

import { errorMessage } from '../../shared/errors'
import { webContents } from 'electron'
import { normalizeToSecondLevel, PaymentPolicyStore } from './payment-policy'
import { rawToFriendly } from './address-utils'
import { WalletManager } from './manager'
import { WalletHistoryManager } from './history'
import { emitToRenderer } from '../ipc/handlers'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { getSetting } from '../settings'
import {
  WALLET_MAX_TIMEOUT_S,
  WALLET_MIN_APPROVAL_TIMEOUT_S,
  TON_MAINNET_CAIP2,
  TON_NATIVE_ASSET,
  X402_VERSION,
  MAX_SINGLE_PAYMENT,
  FETCH_TIMEOUT_MS,
  DEFAULT_APPROVAL_TIMEOUT_S,
} from './constants'
import { ERROR_TRUNCATE_LENGTH } from '../../shared/constants'
import type { PaymentRequirements, PaymentNotificationData, WalletTransaction } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('payment-interceptor')

/** Maximum response body size for 402 payment responses (64 KB) */
const MAX_RESPONSE_BODY = 65_536

/** Stored context for a 402 interception */
interface InterceptedRequest {
  url: string
  webContentsId: number
  session: Electron.Session
}

/** Pending manual approval requests, keyed by payment ID */
const pendingApprovals = new Map<
  string,
  {
    request: InterceptedRequest
    paymentReq: PaymentRequirements
    domain: string
    ttl: ReturnType<typeof setTimeout>
    reservationId?: string
    xhrResolver?: (result: { success: boolean; error?: string }) => void
  }
>()

/** TON raw address regex: 0:<64 hex chars> */
const TON_RAW_ADDRESS_RE = /^0:[0-9a-fA-F]{64}$/

function validatePaymentRequirements(
  req: PaymentRequirements,
  originalDomain: string,
  finalDomain: string,
  isAutoMode: boolean,
  walletManager: WalletManager
): { valid: boolean; reason?: string } {
  if (req.scheme !== 'exact') {
    return { valid: false, reason: `Invalid scheme: ${req.scheme}` }
  }

  if (req.network !== TON_MAINNET_CAIP2) {
    return { valid: false, reason: `Invalid network: ${req.network}` }
  }

  if (req.asset !== TON_NATIVE_ASSET) {
    return { valid: false, reason: `Invalid asset: ${req.asset}` }
  }

  try {
    const amt = BigInt(req.amount)
    if (amt <= 0n) {
      return { valid: false, reason: 'Amount must be > 0' }
    }
  } catch {
    return { valid: false, reason: `Invalid amount: ${req.amount}` }
  }

  // FIX 3: Hard cap on payment amount
  const walletSettings = getSetting('wallet')
  const perRequestLimit = walletSettings.limits.perRequest
  const effectiveLimit = perRequestLimit !== '0' ? BigInt(perRequestLimit) : MAX_SINGLE_PAYMENT
  if (BigInt(req.amount) > effectiveLimit) {
    log.warn('Payment amount exceeds limit')
    return { valid: false, reason: 'amount_exceeds_limit' }
  }

  const walletState = walletManager.getState()
  if (!walletState.isCreated) {
    return { valid: false, reason: 'Wallet not created' }
  }

  if (!TON_RAW_ADDRESS_RE.test(req.payTo)) {
    return { valid: false, reason: `Invalid payTo address: ${req.payTo}` }
  }

  if (req.maxTimeoutSeconds < WALLET_MIN_APPROVAL_TIMEOUT_S || req.maxTimeoutSeconds > WALLET_MAX_TIMEOUT_S) {
    return { valid: false, reason: `Invalid maxTimeoutSeconds: ${req.maxTimeoutSeconds}` }
  }

  if (req.payTo === walletState.addressRaw) {
    return { valid: false, reason: 'Self-payment not allowed' }
  }

  if (isAutoMode && originalDomain !== finalDomain) {
    return { valid: false, reason: 'Cross-domain redirect in auto mode' }
  }

  return { valid: true }
}

/**
 * FIX 4: Fetch with timeout via AbortController.
 * Uses session.fetch to route through the originating session's proxy.
 */
async function sessionFetch(session: Electron.Session, url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await session.fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timeout)
    return response
  } catch (e) {
    clearTimeout(timeout)
    throw e
  }
}

/**
 * Stream response body into a string, bounded by maxBytes. Throws if the body
 * exceeds the limit. Content-Length is unreliable (attacker may omit it or use
 * Transfer-Encoding: chunked) so we track bytes from the actual stream.
 */
async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    if (text.length > maxBytes) {
      throw new Error(`Response body exceeds ${maxBytes} bytes`)
    }
    return text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`Response body exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(merged)
}

export class PaymentInterceptor {
  private walletManager: WalletManager
  private paymentPolicyStore: PaymentPolicyStore
  private walletHistoryManager: WalletHistoryManager
  private xhrTokens = new Map<string, { token: string; expiresAt: number; remainingUses: number }>()
  private inflightXhrPayments = new Map<
    string,
    { promise: Promise<{ success: boolean; error?: string }>; count: number }
  >()

  constructor(
    walletManager: WalletManager,
    paymentPolicyStore: PaymentPolicyStore,
    walletHistoryManager: WalletHistoryManager
  ) {
    this.walletManager = walletManager
    this.paymentPolicyStore = paymentPolicyStore
    this.walletHistoryManager = walletHistoryManager
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
      const body = await readBoundedBody(response, MAX_RESPONSE_BODY)
      paymentReq = JSON.parse(body) as PaymentRequirements
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
    const mode = isCrossDomain ? 'manual' : this.paymentPolicyStore.getSiteMode(originalDomain)

    if (mode === 'off') {
      log.info(`Payment mode is off for ${originalDomain}, ignoring 402`)
      return
    }

    const validation = validatePaymentRequirements(
      paymentReq,
      originalDomain,
      finalDomain,
      mode === 'auto',
      this.walletManager
    )

    if (!validation.valid) {
      log.warn(`PaymentRequirements validation failed: ${validation.reason}`)
      return
    }

    const reservationId = this.paymentPolicyStore.reservePayment(originalDomain, paymentReq.amount)
    if (!reservationId) {
      const notification: PaymentNotificationData = {
        id: crypto.randomUUID(),
        domain: originalDomain,
        url: request.url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        payToFriendly: rawToFriendly(paymentReq.payTo),
        status: 'failed',
        error: 'Spending limit reached',
      }
      emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)
      return
    }

    if (mode === 'auto') {
      await this.executePayment(request, paymentReq, originalDomain, reservationId)
    } else {
      const paymentId = crypto.randomUUID()

      // FIX 6: Auto-reject pending approvals after TTL
      const ttlTimeout = setTimeout(
        () => {
          const pending = pendingApprovals.get(paymentId)
          if (pending) {
            pendingApprovals.delete(paymentId)
            if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
            const notification: PaymentNotificationData = {
              id: paymentId,
              domain: originalDomain,
              url: request.url,
              amount: paymentReq.amount,
              payTo: paymentReq.payTo,
              payToFriendly: rawToFriendly(paymentReq.payTo),
              status: 'rejected',
              error: 'Approval timed out',
            }
            emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)
            log.info(`Payment approval timed out for ${originalDomain}`)
          }
        },
        (paymentReq.maxTimeoutSeconds || DEFAULT_APPROVAL_TIMEOUT_S) * 1_000
      )

      pendingApprovals.set(paymentId, { request, paymentReq, domain: originalDomain, ttl: ttlTimeout, reservationId })

      const notification: PaymentNotificationData = {
        id: paymentId,
        domain: originalDomain,
        url: request.url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        payToFriendly: rawToFriendly(paymentReq.payTo),
        status: 'pending',
      }
      emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_REQ, notification)
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

        const notification: PaymentNotificationData = {
          id: paymentId,
          domain,
          url: request.url,
          amount: paymentReq.amount,
          payTo: paymentReq.payTo,
          payToFriendly: rawToFriendly(paymentReq.payTo),
          status: 'completed',
        }
        emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_MADE, notification)

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

        log.info(`402 payment completed for ${domain}`)
      } else {
        if (reservationId) this.paymentPolicyStore.rollbackPayment(reservationId)
        const errorText = await readBoundedBody(retryResponse, MAX_RESPONSE_BODY).catch(() => 'read error')
        await this.walletHistoryManager.updateStatus(paymentId, 'failed')

        const notification: PaymentNotificationData = {
          id: paymentId,
          domain,
          url: request.url,
          amount: paymentReq.amount,
          payTo: paymentReq.payTo,
          payToFriendly: rawToFriendly(paymentReq.payTo),
          status: 'failed',
          error: `Server returned ${retryResponse.status}: ${errorText.slice(0, ERROR_TRUNCATE_LENGTH)}`,
        }
        emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)

        log.warn(`402 payment retry failed for ${domain}: ${retryResponse.status}`)
      }
    } catch (err) {
      if (reservationId) this.paymentPolicyStore.rollbackPayment(reservationId)
      await this.walletHistoryManager
        .updateStatus(paymentId, 'failed')
        .catch((err) => log.debug('Failed to update payment history status:', err))

      const notification: PaymentNotificationData = {
        id: paymentId,
        domain,
        url: request.url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        payToFriendly: rawToFriendly(paymentReq.payTo),
        status: 'failed',
        error: errorMessage(err),
      }
      emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)

      log.error(`402 payment error for ${domain}:`, err)
    }
  }

  /**
   * Approve a pending manual payment.
   * Called from IPC when the user clicks "Approve" in the renderer.
   */
  async approvePayment(paymentId: string): Promise<void> {
    const pending = pendingApprovals.get(paymentId)
    if (!pending) {
      log.warn(`No pending approval found for ${paymentId}`)
      return
    }

    clearTimeout(pending.ttl)
    pendingApprovals.delete(paymentId)

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

        const notification: PaymentNotificationData = {
          id: paymentId,
          domain: pending.domain,
          url: pending.request.url,
          amount: pending.paymentReq.amount,
          payTo: pending.paymentReq.payTo,
          payToFriendly: rawToFriendly(pending.paymentReq.payTo),
          status: 'completed',
        }
        emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_MADE, notification)
        log.debug(`XHR payment approved for ${pending.domain}`)
        pending.xhrResolver({ success: true })
      } catch (err) {
        this.xhrTokens.delete(`${pending.request.webContentsId}|${pending.request.url}`)
        if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
        const notification: PaymentNotificationData = {
          id: paymentId,
          domain: pending.domain,
          url: pending.request.url,
          amount: pending.paymentReq.amount,
          payTo: pending.paymentReq.payTo,
          payToFriendly: rawToFriendly(pending.paymentReq.payTo),
          status: 'failed',
          error: errorMessage(err),
        }
        emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)
        log.error(`XHR manual payment error for ${pending.domain}:`, err)
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
    const pending = pendingApprovals.get(paymentId)
    if (!pending) return

    clearTimeout(pending.ttl)
    pendingApprovals.delete(paymentId)
    if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)

    const notification: PaymentNotificationData = {
      id: paymentId,
      domain: pending.domain,
      url: pending.request.url,
      amount: pending.paymentReq.amount,
      payTo: pending.paymentReq.payTo,
      payToFriendly: rawToFriendly(pending.paymentReq.payTo),
      status: 'rejected',
    }
    emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)
    log.info(`Payment rejected for ${pending.domain}`)
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
    const key = `${webContentsId}|${url}`
    this.xhrTokens.set(key, {
      token: xPaymentHeader,
      expiresAt: Date.now() + ttlMs,
      remainingUses: Math.max(1, uses),
    })
  }

  /**
   * Retrieve and remove a stored XHR token for use in onBeforeSendHeaders.
   * Returns null if the key is missing or the token has expired.
   */
  consumeXhrPaymentToken(webContentsId: number, url: string): string | null {
    const key = `${webContentsId}|${url}`
    const entry = this.xhrTokens.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.xhrTokens.delete(key)
      return null
    }
    entry.remainingUses--
    if (entry.remainingUses <= 0) {
      this.xhrTokens.delete(key)
    }
    return entry.token
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
      const body = await readBoundedBody(response, MAX_RESPONSE_BODY)
      paymentReq = JSON.parse(body) as PaymentRequirements
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
    const mode = isCrossDomain ? 'manual' : this.paymentPolicyStore.getSiteMode(originalDomain)

    if (mode === 'off') {
      return { success: false, error: 'policy-off' }
    }

    const validation = validatePaymentRequirements(
      paymentReq,
      originalDomain,
      finalDomain,
      mode === 'auto',
      this.walletManager
    )
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

        const notification: PaymentNotificationData = {
          id: paymentId,
          domain: originalDomain,
          url,
          amount: paymentReq.amount,
          payTo: paymentReq.payTo,
          payToFriendly: rawToFriendly(paymentReq.payTo),
          status: 'completed',
        }
        emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_MADE, notification)
        log.debug(`XHR payment signed for ${originalDomain}`)
        return { success: true }
      } catch (err) {
        this.xhrTokens.delete(`${webContentsId}|${url}`)
        this.paymentPolicyStore.rollbackPayment(reservationId)
        log.error(`XHR auto payment error for ${originalDomain}:`, err)
        return { success: false, error: errorMessage(err) }
      }
    }

    const paymentId = crypto.randomUUID()
    return new Promise((resolve) => {
      const ttlTimeout = setTimeout(
        () => {
          const pending = pendingApprovals.get(paymentId)
          if (pending) {
            pendingApprovals.delete(paymentId)
            if (pending.reservationId) this.paymentPolicyStore.rollbackPayment(pending.reservationId)
            const notification: PaymentNotificationData = {
              id: paymentId,
              domain: originalDomain,
              url,
              amount: paymentReq.amount,
              payTo: paymentReq.payTo,
              payToFriendly: rawToFriendly(paymentReq.payTo),
              status: 'rejected',
              error: 'Approval timed out',
            }
            emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_FAILED, notification)
            log.debug(`XHR payment approval timed out for ${originalDomain}`)
            pending.xhrResolver?.({ success: false, error: 'timeout' })
          }
        },
        (paymentReq.maxTimeoutSeconds || DEFAULT_APPROVAL_TIMEOUT_S) * 1_000
      )

      pendingApprovals.set(paymentId, {
        request: { url, webContentsId, session },
        paymentReq,
        domain: originalDomain,
        ttl: ttlTimeout,
        reservationId,
        xhrResolver: resolve,
      })

      const notification: PaymentNotificationData = {
        id: paymentId,
        domain: originalDomain,
        url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        payToFriendly: rawToFriendly(paymentReq.payTo),
        status: 'pending',
      }
      emitToRenderer(IPC_CHANNELS.WALLET_PAYMENT_REQ, notification)
    })
  }

  /**
   * Clean up all pending approvals and their TTL timers.
   * Called on app exit via destroyServices().
   */
  destroy(): void {
    for (const [, pending] of pendingApprovals) {
      clearTimeout(pending.ttl)
      if (pending.reservationId) {
        this.paymentPolicyStore.rollbackPayment(pending.reservationId)
      }
    }
    pendingApprovals.clear()
    this.xhrTokens.clear()
  }
}

// Singleton removed: use ServiceRegistry from services.ts
