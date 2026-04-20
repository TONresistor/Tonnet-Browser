/**
 * Unit tests for PaymentInterceptor.
 * Covers: validation, auto/manual/off modes, cross-domain, TTL expiration,
 * fetch timeout, rollback on failure.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PaymentRequirements } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Module mocks (must be declared before imports that use them)
// ---------------------------------------------------------------------------

const mockGetSetting = vi.fn()
vi.mock('../../settings', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

const mockEmitToRenderer = vi.fn()
vi.mock('../../ipc/handlers', () => ({
  emitToRenderer: (...args: unknown[]) => mockEmitToRenderer(...args),
}))

const mockGetAllWebContents = vi.fn(() => [])
vi.mock('electron', () => ({
  webContents: {
    getAllWebContents: () => mockGetAllWebContents(),
  },
}))

// Mock crypto.randomUUID with incrementing counter (never reset, since
// the module-level pendingApprovals Map persists across tests)
let uuidCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
})

/** Flush microtask queue so floating promises settle. */
async function flushPromises(): Promise<void> {
  // vi.advanceTimersByTimeAsync triggers timers AND flushes microtasks
  await vi.advanceTimersByTimeAsync(0)
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PaymentInterceptor } from '../payment-interceptor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ADDRESS = '0:' + 'a'.repeat(64)
const OTHER_ADDRESS = '0:' + 'b'.repeat(64)

function makePaymentReq(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'tvm:-239',
    asset: 'native',
    amount: '100000000', // 0.1 TON
    payTo: OTHER_ADDRESS,
    maxTimeoutSeconds: 60,
    ...overrides,
  }
}

function createMockWalletManager() {
  return {
    getState: vi.fn(() => ({
      isCreated: true,
      addressRaw: VALID_ADDRESS,
      address: 'EQ...',
    })),
    signX402Payment: vi.fn().mockResolvedValue({
      signedBoc: 'base64boc',
      walletPublicKey: 'pubkey',
      walletAddress: VALID_ADDRESS,
      seqno: 1,
      validUntil: Math.floor(Date.now() / 1000) + 300,
    }),
    on: vi.fn(),
  }
}

function createMockPolicyStore() {
  return {
    getSiteMode: vi.fn(() => 'auto' as const),
    reservePayment: vi.fn(() => 'reservation-1'),
    confirmPayment: vi.fn(),
    rollbackPayment: vi.fn(),
    checkRateLimit: vi.fn(() => true),
  }
}

function createMockHistoryManager() {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  }
}

function defaultWalletSettings() {
  return {
    paymentMode: 'auto',
    limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
    sitePolicies: [],
    autoPayDomains: [],
    autoLockMinutes: 5,
    notificationStyle: 'toast',
  }
}

function makeJsonResponse(status: number, payload: unknown, ok = status < 400) {
  const text = JSON.stringify(payload)
  return {
    status,
    ok,
    json: vi.fn().mockResolvedValue(payload),
    text: vi.fn().mockResolvedValue(text),
  }
}

function createMockSession(fetchResponse?: Partial<Response>) {
  const defaultResponse = makeJsonResponse(402, makePaymentReq(), false)
  return {
    fetch: vi.fn().mockResolvedValue({ ...defaultResponse, ...fetchResponse }),
    webRequest: {
      onCompleted: vi.fn(),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaymentInterceptor', () => {
  let walletManager: ReturnType<typeof createMockWalletManager>
  let policyStore: ReturnType<typeof createMockPolicyStore>
  let historyManager: ReturnType<typeof createMockHistoryManager>
  let interceptor: PaymentInterceptor

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    walletManager = createMockWalletManager()
    policyStore = createMockPolicyStore()
    historyManager = createMockHistoryManager()

    mockGetSetting.mockReturnValue(defaultWalletSettings())

    interceptor = new PaymentInterceptor(walletManager as any, policyStore as any, historyManager as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // =========================================================================
  // validatePaymentRequirements (tested indirectly via handle402)
  // =========================================================================

  describe('validatePaymentRequirements', () => {
    // We test validation indirectly: when validation fails, handle402 returns
    // without reserving or emitting payment events.

    function setupHandle402(paymentReq: PaymentRequirements, mode = 'auto') {
      const session = createMockSession({
        status: 402,
        ok: false,
        json: vi.fn().mockResolvedValue(paymentReq),
        text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
      })
      policyStore.getSiteMode.mockReturnValue(mode)

      // Simulate webContents for domain detection
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      return session
    }

    async function triggerHandle402(
      session: ReturnType<typeof createMockSession>,
      url = 'https://example.com/resource'
    ) {
      // registerOnSession stores the callback; we extract and call it
      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url,
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      // Flush microtasks
      await vi.runAllTimersAsync()
    }

    it('rejects invalid scheme', async () => {
      const req = makePaymentReq({ scheme: 'stream' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects invalid network', async () => {
      const req = makePaymentReq({ network: 'eip155:1' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects invalid asset', async () => {
      const req = makePaymentReq({ asset: 'USDT' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects amount <= 0', async () => {
      const req = makePaymentReq({ amount: '0' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects negative amount', async () => {
      const req = makePaymentReq({ amount: '-100' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects non-numeric amount', async () => {
      const req = makePaymentReq({ amount: 'abc' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects amount exceeding MAX_SINGLE_PAYMENT (1 TON)', async () => {
      const req = makePaymentReq({ amount: '1000000001' }) // 1 TON + 1 nanoTON
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('accepts amount exactly at MAX_SINGLE_PAYMENT', async () => {
      const req = makePaymentReq({ amount: '1000000000' }) // exactly 1 TON
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).toHaveBeenCalled()
    })

    it('rejects amount exceeding custom perRequest limit', async () => {
      mockGetSetting.mockReturnValue({
        ...defaultWalletSettings(),
        limits: { perRequest: '50000000', perDay: '0', perSitePerMonth: '0' },
      })
      const req = makePaymentReq({ amount: '50000001' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects invalid payTo address format', async () => {
      const req = makePaymentReq({ payTo: 'EQnotarawaddress' })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects self-payment (payTo === wallet address)', async () => {
      const req = makePaymentReq({ payTo: VALID_ADDRESS })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects maxTimeoutSeconds <= 0', async () => {
      const req = makePaymentReq({ maxTimeoutSeconds: 0 })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects maxTimeoutSeconds > WALLET_MAX_TIMEOUT_S (300)', async () => {
      const req = makePaymentReq({ maxTimeoutSeconds: 301 })
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects when wallet not created', async () => {
      walletManager.getState.mockReturnValue({ isCreated: false, addressRaw: '' })
      const req = makePaymentReq()
      const session = setupHandle402(req)
      await triggerHandle402(session)

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })

    it('rejects cross-domain redirect in auto mode', async () => {
      const req = makePaymentReq()
      const session = setupHandle402(req, 'auto')

      // webContents reports original domain as different from URL domain
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://original-site.com/page' }])

      await triggerHandle402(session, 'https://payment-redirect.com/pay')

      // Cross-domain forces manual mode, which should still call reservePayment
      // but emit wallet:payment-req not wallet:payment-made
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-req',
        expect.objectContaining({ status: 'pending' })
      )
    })
  })

  // =========================================================================
  // Mode: auto
  // =========================================================================

  describe('mode auto', () => {
    function setupAutoMode() {
      const retryResponse = {
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue('OK'),
      }
      const paymentReq = makePaymentReq()
      const session = createMockSession()
      // First call: re-fetch returns 402 with payment requirements
      // Second call: retry with X-PAYMENT header returns 200
      session.fetch
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          json: vi.fn().mockResolvedValue(paymentReq),
          text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
        })
        .mockResolvedValueOnce(retryResponse)

      policyStore.getSiteMode.mockReturnValue('auto')
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page', loadURL: vi.fn() }])

      return session
    }

    it('executes payment without interaction', async () => {
      const session = setupAutoMode()
      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/resource',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(walletManager.signX402Payment).toHaveBeenCalled()
      expect(historyManager.add).toHaveBeenCalledWith(expect.objectContaining({ type: 'x402', status: 'pending' }))
      expect(policyStore.confirmPayment).toHaveBeenCalledWith('reservation-1')
      expect(historyManager.updateStatus).toHaveBeenCalledWith(expect.any(String), 'confirmed')
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-made',
        expect.objectContaining({ status: 'completed' })
      )
    })

    it('rolls back reservation on payment failure (server error)', async () => {
      const paymentReq = makePaymentReq()
      const session = createMockSession()
      session.fetch
        .mockResolvedValueOnce({
          status: 402,
          ok: false,
          json: vi.fn().mockResolvedValue(paymentReq),
          text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
        })
        .mockResolvedValueOnce({
          status: 500,
          ok: false,
          text: vi.fn().mockResolvedValue('Internal Server Error'),
        })

      policyStore.getSiteMode.mockReturnValue('auto')
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/resource',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(policyStore.rollbackPayment).toHaveBeenCalledWith('reservation-1')
      expect(historyManager.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed')
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-failed',
        expect.objectContaining({ status: 'failed' })
      )
    })

    it('rolls back reservation on signX402Payment exception', async () => {
      const paymentReq = makePaymentReq()
      const session = createMockSession()
      session.fetch.mockResolvedValueOnce({
        status: 402,
        ok: false,
        json: vi.fn().mockResolvedValue(paymentReq),
        text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
      })

      walletManager.signX402Payment.mockRejectedValueOnce(new Error('signing failed'))
      policyStore.getSiteMode.mockReturnValue('auto')
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/resource',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(policyStore.rollbackPayment).toHaveBeenCalledWith('reservation-1')
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-failed',
        expect.objectContaining({ error: 'signing failed' })
      )
    })
  })

  // =========================================================================
  // Mode: manual
  // =========================================================================

  describe('mode manual', () => {
    function setupManualMode() {
      const paymentReq = makePaymentReq()
      const session = createMockSession()
      session.fetch.mockResolvedValueOnce({
        status: 402,
        ok: false,
        json: vi.fn().mockResolvedValue(paymentReq),
        text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
      })

      policyStore.getSiteMode.mockReturnValue('manual')
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      return session
    }

    /** Trigger a 402 and wait for the floating handle402 promise to settle. */
    async function trigger402(session: ReturnType<typeof createMockSession>, url = 'https://example.com/resource') {
      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      callback({
        url,
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      // Flush the floating handle402 promise chain
      await flushPromises()
    }

    it('queues payment for approval', async () => {
      const session = setupManualMode()
      await trigger402(session)

      // Should NOT sign or execute
      expect(walletManager.signX402Payment).not.toHaveBeenCalled()
      // Should emit pending notification
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-req',
        expect.objectContaining({ status: 'pending', domain: 'example.com' })
      )
    })

    it('TTL expiration auto-rejects pending payment', async () => {
      const session = setupManualMode()
      await trigger402(session)

      // Clear mocks to isolate TTL-triggered calls
      mockEmitToRenderer.mockClear()
      policyStore.rollbackPayment.mockClear()

      // Advance past maxTimeoutSeconds (60s default from makePaymentReq)
      vi.advanceTimersByTime(60_000)
      await flushPromises()

      expect(policyStore.rollbackPayment).toHaveBeenCalledWith('reservation-1')
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-failed',
        expect.objectContaining({
          status: 'rejected',
          error: 'Approval timed out',
        })
      )
    })

    it('approvePayment executes the queued payment', async () => {
      const session = setupManualMode()
      // Second fetch for the retry after approval
      session.fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: vi.fn().mockResolvedValue('OK'),
      })
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page', loadURL: vi.fn() }])

      await trigger402(session)

      // Get the payment ID from the pending notification
      const pendingCall = mockEmitToRenderer.mock.calls.find((c) => c[0] === 'wallet:payment-req')
      const paymentId = pendingCall![1].id

      mockEmitToRenderer.mockClear()
      await interceptor.approvePayment(paymentId)
      await flushPromises()

      expect(walletManager.signX402Payment).toHaveBeenCalled()
      expect(policyStore.confirmPayment).toHaveBeenCalledWith('reservation-1')
    })

    it('rejectPayment rolls back and notifies', async () => {
      const session = setupManualMode()
      await trigger402(session)

      const pendingCall = mockEmitToRenderer.mock.calls.find((c) => c[0] === 'wallet:payment-req')
      const paymentId = pendingCall![1].id

      mockEmitToRenderer.mockClear()
      policyStore.rollbackPayment.mockClear()

      interceptor.rejectPayment(paymentId)

      expect(policyStore.rollbackPayment).toHaveBeenCalledWith('reservation-1')
      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-failed',
        expect.objectContaining({ status: 'rejected' })
      )
    })
  })

  // =========================================================================
  // Mode: off
  // =========================================================================

  describe('mode off', () => {
    it('ignores 402 silently', async () => {
      const paymentReq = makePaymentReq()
      const session = createMockSession()
      session.fetch.mockResolvedValueOnce({
        status: 402,
        ok: false,
        json: vi.fn().mockResolvedValue(paymentReq),
        text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
      })

      policyStore.getSiteMode.mockReturnValue('off')
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/resource',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(policyStore.reservePayment).not.toHaveBeenCalled()
      expect(walletManager.signX402Payment).not.toHaveBeenCalled()
      expect(mockEmitToRenderer).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Fetch timeout
  // =========================================================================

  describe('fetch timeout', () => {
    it('aborts re-fetch after FETCH_TIMEOUT_MS (30s)', async () => {
      const session = createMockSession()
      // Make fetch hang until abort
      session.fetch.mockImplementation((_url: string, opts?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }
        })
      })

      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]

      // Trigger 402 (will start fetch that hangs)
      const handlePromise = callback({
        url: 'https://example.com/resource',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })

      // Advance past FETCH_TIMEOUT_MS
      vi.advanceTimersByTime(30_000)
      await vi.runAllTimersAsync()
      await handlePromise

      // The fetch was aborted, so no payment should be attempted
      expect(walletManager.signX402Payment).not.toHaveBeenCalled()
      expect(policyStore.reservePayment).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Spending limit reached
  // =========================================================================

  describe('spending limit', () => {
    it('emits payment-failed when reservePayment returns null', async () => {
      const paymentReq = makePaymentReq()
      const session = createMockSession()
      session.fetch.mockResolvedValueOnce({
        status: 402,
        ok: false,
        json: vi.fn().mockResolvedValue(paymentReq),
        text: vi.fn().mockResolvedValue(JSON.stringify(paymentReq)),
      })

      policyStore.getSiteMode.mockReturnValue('auto')
      policyStore.reservePayment.mockReturnValue(null)
      mockGetAllWebContents.mockReturnValue([{ id: 1, getURL: () => 'https://example.com/page' }])

      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/resource',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(mockEmitToRenderer).toHaveBeenCalledWith(
        'wallet:payment-failed',
        expect.objectContaining({
          status: 'failed',
          error: 'Spending limit reached',
        })
      )
      expect(walletManager.signX402Payment).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // registerOnSession filtering
  // =========================================================================

  describe('registerOnSession', () => {
    it('ignores non-mainFrame resources', async () => {
      const session = createMockSession()
      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/style.css',
        statusCode: 402,
        resourceType: 'stylesheet',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(session.fetch).not.toHaveBeenCalled()
    })

    it('ignores non-402 status codes', async () => {
      const session = createMockSession()
      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/page',
        statusCode: 200,
        resourceType: 'mainFrame',
        webContentsId: 1,
      })
      await vi.runAllTimersAsync()

      expect(session.fetch).not.toHaveBeenCalled()
    })

    it('ignores requests without webContentsId', async () => {
      const session = createMockSession()
      interceptor.registerOnSession(session as any)
      const callback = session.webRequest.onCompleted.mock.calls[0][1]
      await callback({
        url: 'https://example.com/page',
        statusCode: 402,
        resourceType: 'mainFrame',
        webContentsId: null,
      })
      await vi.runAllTimersAsync()

      expect(session.fetch).not.toHaveBeenCalled()
    })
  })
})
