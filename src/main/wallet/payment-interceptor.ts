/**
 * HTTP 402 payment interceptor.
 * Registers on Electron sessions to intercept 402 responses,
 * validate PaymentRequirements, and handle auto/manual payment flows.
 */

import { webContents } from 'electron'
import { paymentPolicyStore, normalizeToSecondLevel } from './payment-policy'
import { walletManager } from './manager'
import { walletHistoryManager } from './history'
import { emitToRenderer } from '../ipc/handlers'
import { getSetting } from '../settings'
import { WALLET_MAX_TIMEOUT_SECONDS, TON_MAINNET_CAIP2, TON_NATIVE_ASSET, X402_VERSION } from '../../shared/constants'
import type { PaymentRequirements, PaymentNotificationData, WalletTransaction } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('payment-interceptor')

/** Hard cap on a single payment: 1 TON in nanoTON */
const MAX_SINGLE_PAYMENT = 1_000_000_000n

/** Default fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 30_000

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
  }
>()

/** TON raw address regex: 0:<64 hex chars> */
const TON_RAW_ADDRESS_RE = /^0:[0-9a-fA-F]{64}$/

function validatePaymentRequirements(
  req: PaymentRequirements,
  originalDomain: string,
  finalDomain: string,
  isAutoMode: boolean
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

  if (req.maxTimeoutSeconds <= 0 || req.maxTimeoutSeconds > WALLET_MAX_TIMEOUT_SECONDS) {
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

class PaymentInterceptor {
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
    const walletState = walletManager.getState()
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

    let paymentReq: PaymentRequirements
    try {
      paymentReq = (await response.json()) as PaymentRequirements
    } catch (err) {
      log.error('Failed to parse PaymentRequirements JSON:', err)
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
    const mode = isCrossDomain ? 'manual' : paymentPolicyStore.getSiteMode(originalDomain)

    if (mode === 'off') {
      log.info(`Payment mode is off for ${originalDomain}, ignoring 402`)
      return
    }

    const validation = validatePaymentRequirements(paymentReq, originalDomain, finalDomain, mode === 'auto')

    if (!validation.valid) {
      log.warn(`PaymentRequirements validation failed: ${validation.reason}`)
      return
    }

    const reservationId = paymentPolicyStore.reservePayment(originalDomain, paymentReq.amount)
    if (!reservationId) {
      const notification: PaymentNotificationData = {
        id: crypto.randomUUID(),
        domain: originalDomain,
        url: request.url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        status: 'failed',
        error: 'Spending limit reached',
      }
      emitToRenderer('wallet:payment-failed', notification)
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
            if (pending.reservationId) paymentPolicyStore.rollbackPayment(pending.reservationId)
            const notification: PaymentNotificationData = {
              id: paymentId,
              domain: originalDomain,
              url: request.url,
              amount: paymentReq.amount,
              payTo: paymentReq.payTo,
              status: 'rejected',
              error: 'Approval timed out',
            }
            emitToRenderer('wallet:payment-failed', notification)
            log.info(`Payment approval timed out for ${originalDomain}`)
          }
        },
        (paymentReq.maxTimeoutSeconds || 60) * 1000
      )

      pendingApprovals.set(paymentId, { request, paymentReq, domain: originalDomain, ttl: ttlTimeout, reservationId })

      const notification: PaymentNotificationData = {
        id: paymentId,
        domain: originalDomain,
        url: request.url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        status: 'pending',
      }
      emitToRenderer('wallet:payment-req', notification)
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
      await walletHistoryManager.add(pendingTx)

      // Sign BOC
      const payload = await walletManager.signX402Payment(paymentReq)

      // Build X-PAYMENT header (JSON.stringify, NOT base64)
      const xPaymentHeader = JSON.stringify({
        x402Version: X402_VERSION,
        payload,
      })
      // SECURITY: NEVER log xPaymentHeader

      // Retry through session with timeout
      const retryResponse = await sessionFetch(session, request.url, {
        headers: { 'X-PAYMENT': xPaymentHeader },
      })

      if (retryResponse.ok) {
        if (reservationId) paymentPolicyStore.confirmPayment(reservationId)

        await walletHistoryManager.updateStatus(paymentId, 'confirmed')

        const notification: PaymentNotificationData = {
          id: paymentId,
          domain,
          url: request.url,
          amount: paymentReq.amount,
          payTo: paymentReq.payTo,
          status: 'completed',
        }
        emitToRenderer('wallet:payment-made', notification)

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
        if (reservationId) paymentPolicyStore.rollbackPayment(reservationId)
        const errorText = await retryResponse.text()
        await walletHistoryManager.updateStatus(paymentId, 'failed')

        const notification: PaymentNotificationData = {
          id: paymentId,
          domain,
          url: request.url,
          amount: paymentReq.amount,
          payTo: paymentReq.payTo,
          status: 'failed',
          error: `Server returned ${retryResponse.status}: ${errorText.slice(0, 200)}`,
        }
        emitToRenderer('wallet:payment-failed', notification)

        log.warn(`402 payment retry failed for ${domain}: ${retryResponse.status}`)
      }
    } catch (err) {
      if (reservationId) paymentPolicyStore.rollbackPayment(reservationId)
      await walletHistoryManager
        .updateStatus(paymentId, 'failed')
        .catch((err) => log.debug('Failed to update payment history status:', err))

      const notification: PaymentNotificationData = {
        id: paymentId,
        domain,
        url: request.url,
        amount: paymentReq.amount,
        payTo: paymentReq.payTo,
        status: 'failed',
        error: (err as Error).message,
      }
      emitToRenderer('wallet:payment-failed', notification)

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
    await this.executePayment(pending.request, pending.paymentReq, pending.domain, pending.reservationId)
  }

  /**
   * Reject a pending manual payment.
   */
  rejectPayment(paymentId: string): void {
    const pending = pendingApprovals.get(paymentId)
    if (!pending) return

    clearTimeout(pending.ttl)
    pendingApprovals.delete(paymentId)
    if (pending.reservationId) paymentPolicyStore.rollbackPayment(pending.reservationId)

    const notification: PaymentNotificationData = {
      id: paymentId,
      domain: pending.domain,
      url: pending.request.url,
      amount: pending.paymentReq.amount,
      payTo: pending.paymentReq.payTo,
      status: 'rejected',
    }
    emitToRenderer('wallet:payment-failed', notification)
    log.info(`Payment rejected for ${pending.domain}`)
  }
}

export const paymentInterceptor = new PaymentInterceptor()
