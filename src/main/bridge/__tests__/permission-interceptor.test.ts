import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock: ws  (vi.mock is hoisted, so no outside references allowed)
// ---------------------------------------------------------------------------
/** Latest MockWebSocket instance, set via globalThis in the ws mock */
function getLatestWs(): any {
  return (globalThis as any).__latestWs
}

function getSockets(): any[] {
  return (globalThis as any).__sockets
}

vi.mock('ws', async () => {
  const { EventEmitter: EE } = await import('events')
  const { vi: _vi } = await import('vitest')

  class MockWebSocket extends EE {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    send = _vi.fn()
    close = _vi.fn(function (this: any) {
      this.readyState = 3
    })
    terminate = _vi.fn()
    url: string

    constructor(url: string) {
      super()
      this.url = url
      // Expose to tests via a global-ish holder injected at module scope
      ;(globalThis as any).__latestWs = this
      ;((globalThis as any).__sockets ??= []).push(this)
      setTimeout(() => this.emit('open'), 0)
    }
  }

  return { default: MockWebSocket, __esModule: true }
})

// ---------------------------------------------------------------------------
// Mock: settings, main window, logger
// ---------------------------------------------------------------------------
vi.mock('../../settings', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'network') return { wsPort: 9999 }
    if (key === 'bridge') return { defaultPolicy: 'ask', permissions: [] }
    return {}
  }),
}))

vi.mock('../../windows/main', () => ({
  getMainWindow: vi.fn(() => ({
    getContentBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
  })),
}))

vi.mock('../../../shared/logger', () => ({
  RepetitionAggregator: class {
    record = vi.fn()
    recovered = vi.fn()
  },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    status: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { BridgePermissionInterceptor } from '../permission-interceptor'
import { methodToScope } from '../permission-store'
import { RPC_TIMEOUT_MS } from '../constants'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockPermissionStore() {
  return {
    init: vi.fn(),
    getPermission: vi.fn((): 'granted' | 'denied' | 'unknown' => 'unknown'),
    setPermission: vi.fn(() => Promise.resolve()),
    clearSessionGrants: vi.fn(),
    revokePermission: vi.fn(() => Promise.resolve()),
    revokeSessionPermission: vi.fn(),
    getAllPermissions: vi.fn(() => []),
    getDefaultPolicy: vi.fn(() => 'ask' as 'ask' | 'deny'),
  }
}

function createMockOverlayManager() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
  }
}

function createMockSender() {
  const destroyCallbacks: Array<() => void> = []
  return {
    id: 1,
    send: vi.fn(),
    once: vi.fn((event: string, cb: () => void) => {
      if (event === 'destroyed') destroyCallbacks.push(cb)
    }),
    isDestroyed: vi.fn(() => false),
    _triggerDestroyed() {
      for (const cb of destroyCallbacks) cb()
    },
  } as unknown as Electron.WebContents & { _triggerDestroyed: () => void }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BridgePermissionInterceptor', () => {
  let store: ReturnType<typeof createMockPermissionStore>
  let overlay: ReturnType<typeof createMockOverlayManager>
  let interceptor: BridgePermissionInterceptor

  beforeEach(() => {
    vi.useFakeTimers()
    store = createMockPermissionStore()
    overlay = createMockOverlayManager()
    interceptor = new BridgePermissionInterceptor(store as any, overlay as any)
    ;(globalThis as any).__latestWs = null
    ;(globalThis as any).__sockets = []
  })

  afterEach(() => {
    interceptor.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // -----------------------------------------------------------------------
  // 1. JSON-RPC parse error
  // -----------------------------------------------------------------------
  describe('JSON-RPC parse error', () => {
    it('returns -32700 for invalid JSON', async () => {
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0) // let ws open

      const sendResponse = vi.fn()
      await interceptor.handleRequest('example.ton', '{not-json', sendResponse)

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.jsonrpc).toBe('2.0')
      expect(res.id).toBeNull()
      expect(res.error.code).toBe(-32700)
      expect(res.error.message).toBe('Parse error')
    })
  })

  // -----------------------------------------------------------------------
  // 2. Unknown method rejected
  // -----------------------------------------------------------------------
  describe('unknown method', () => {
    it('returns -32601 for unknown method', async () => {
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 1, method: 'foo.bar' })
      await interceptor.handleRequest('example.ton', data, sendResponse)

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32601)
      expect(res.error.message).toBe('Unknown method')
      expect(res.id).toBe(1)
    })

    it('returns -32600 for missing method', async () => {
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 5 })
      await interceptor.handleRequest('example.ton', data, sendResponse)

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32600)
      expect(res.error.message).toBe('Invalid request')
      expect(res.id).toBe(5)
    })
  })

  // -----------------------------------------------------------------------
  // 3. methodToScope() mapping
  // -----------------------------------------------------------------------
  describe('methodToScope', () => {
    it('maps lite.getAccountState to blockchain', () => {
      expect(methodToScope('lite.getAccountState')).toBe('blockchain')
    })

    it('maps dns.resolve to blockchain', () => {
      expect(methodToScope('dns.resolve')).toBe('blockchain')
    })

    it('maps subscribe.blocks to blockchain', () => {
      expect(methodToScope('subscribe.blocks')).toBe('blockchain')
    })

    it('maps dht.findValue to p2p', () => {
      expect(methodToScope('dht.findValue')).toBe('p2p')
    })

    it('maps adnl.connect to p2p', () => {
      expect(methodToScope('adnl.connect')).toBe('p2p')
    })

    it('maps overlay.getNodes to p2p', () => {
      expect(methodToScope('overlay.getNodes')).toBe('p2p')
    })

    it('maps lite.sendMessage to write', () => {
      expect(methodToScope('lite.sendMessage')).toBe('write')
    })

    it('maps adnl.sendMessage to write', () => {
      expect(methodToScope('adnl.sendMessage')).toBe('write')
    })

    it('maps dht.storeAddress to write', () => {
      expect(methodToScope('dht.storeAddress')).toBe('write')
    })

    it('returns null for unknown namespace', () => {
      expect(methodToScope('foo.bar')).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // 4. Permission denied
  // -----------------------------------------------------------------------
  describe('permission denied', () => {
    it('returns -32003 when store says denied', async () => {
      store.getPermission.mockReturnValue('denied')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 10, method: 'lite.getAccountState' })
      await interceptor.handleRequest('evil.ton', data, sendResponse)

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32003)
      expect(res.error.message).toContain('Permission denied')
      expect(res.error.message).toContain('evil.ton')
      expect(res.id).toBe(10)
    })

    it('returns -32003 when default policy is deny and permission is unknown', async () => {
      store.getPermission.mockReturnValue('unknown')
      store.getDefaultPolicy.mockReturnValue('deny')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 11, method: 'lite.getAccountState' })
      await interceptor.handleRequest('blocked.ton', data, sendResponse)

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32003)
      expect(res.error.message).toBe('Bridge access denied by default policy')
    })
  })

  // -----------------------------------------------------------------------
  // 5. Permission granted forwards to bridge
  // -----------------------------------------------------------------------
  describe('permission granted', () => {
    it('forwards request to bridge when permission is granted', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getLatestWs()
      expect(ws).not.toBeNull()

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 42, method: 'lite.getAccountState', params: { addr: 'EQ...' } })
      await interceptor.handleRequest('app.ton', data, sendResponse)

      expect(ws.send).toHaveBeenCalledTimes(1)
      // Verify the id was rewritten (not 42)
      const sent = JSON.parse(ws.send.mock.calls[0][0])
      expect(sent.id).not.toBe(42)
      expect(sent.method).toBe('lite.getAccountState')
      expect(sent.params).toEqual({ addr: 'EQ...' })
    })

    it('returns bridge-not-connected when ws is closed', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getLatestWs()
      ws.readyState = 3 // CLOSED

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 1, method: 'lite.getAccountState' })
      await interceptor.handleRequest('app.ton', data, sendResponse)

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32000)
      expect(res.error.message).toBe('Bridge not connected')
    })
  })

  // -----------------------------------------------------------------------
  // 6. Session grant vs persistent grant
  // -----------------------------------------------------------------------
  describe('session vs persistent grant', () => {
    it('stores session grant on "allow"', async () => {
      store.getPermission.mockReturnValue('unknown')
      store.getDefaultPolicy.mockReturnValue('ask')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 1, method: 'lite.getAccountState' })
      const promise = interceptor.handleRequest('app.ton', data, sendResponse)

      // The overlay show callback is the 4th argument
      expect(overlay.show).toHaveBeenCalledTimes(1)
      const callback = overlay.show.mock.calls[0][3] as (action: string) => void

      // Simulate user clicking "allow" (session grant)
      callback('allow')
      await promise

      expect(store.setPermission).toHaveBeenCalledWith('app.ton', 'blockchain', 'session')
    })

    it('stores persistent grant on "always-allow"', async () => {
      store.getPermission.mockReturnValue('unknown')
      store.getDefaultPolicy.mockReturnValue('ask')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 2, method: 'lite.getAccountState' })
      const promise = interceptor.handleRequest('app.ton', data, sendResponse)

      const callback = overlay.show.mock.calls[0][3] as (action: string) => void
      callback('always-allow')
      await promise

      expect(store.setPermission).toHaveBeenCalledWith('app.ton', 'blockchain', 'granted')
    })

    it('denies the request when a persistent grant cannot be saved', async () => {
      store.getPermission.mockReturnValue('unknown')
      store.getDefaultPolicy.mockReturnValue('ask')
      store.setPermission.mockRejectedValueOnce(new Error('disk full'))
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const promise = interceptor.handleRequest(
        'app.ton',
        JSON.stringify({ id: 2, method: 'lite.getAccountState' }),
        sendResponse
      )
      const callback = overlay.show.mock.calls[0][3] as (action: string) => void
      callback('always-allow')
      await promise

      expect(JSON.parse(sendResponse.mock.calls[0][0]).error.code).toBe(-32003)
      expect(getLatestWs().send).not.toHaveBeenCalled()
    })

    it('denies on "deny" action', async () => {
      store.getPermission.mockReturnValue('unknown')
      store.getDefaultPolicy.mockReturnValue('ask')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 3, method: 'lite.getAccountState' })
      const promise = interceptor.handleRequest('app.ton', data, sendResponse)

      const callback = overlay.show.mock.calls[0][3] as (action: string) => void
      callback('deny')
      await promise

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32003)
      expect(res.error.message).toBe('Permission denied by user')
      expect(store.setPermission).not.toHaveBeenCalled()
    })

    it('denies on "dismiss" action', async () => {
      store.getPermission.mockReturnValue('unknown')
      store.getDefaultPolicy.mockReturnValue('ask')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 4, method: 'lite.getAccountState' })
      const promise = interceptor.handleRequest('app.ton', data, sendResponse)

      const callback = overlay.show.mock.calls[0][3] as (action: string) => void
      callback('dismiss')
      await promise

      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.error.code).toBe(-32003)
      expect(store.setPermission).not.toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // 7. RPC ID rewrite + 60s timeout
  // -----------------------------------------------------------------------
  describe('RPC ID rewrite and timeout', () => {
    it('rewrites the id and restores it in the response', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getLatestWs()
      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 99, method: 'lite.getAccountState' })
      await interceptor.handleRequest('app.ton', data, sendResponse)

      // Get the internal id from the sent message
      const sent = JSON.parse(ws.send.mock.calls[0][0])
      const internalId = sent.id
      expect(internalId).not.toBe(99)

      // Simulate bridge response with internal id
      ws.emit('message', JSON.stringify({ jsonrpc: '2.0', id: internalId, result: { balance: '100' } }))

      expect(sendResponse).toHaveBeenCalledTimes(1)
      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.id).toBe(99)
      expect(res.result).toEqual({ balance: '100' })
    })

    it('times out after RPC_TIMEOUT_MS', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 50, method: 'lite.getAccountState' })
      await interceptor.handleRequest('app.ton', data, sendResponse)

      expect(sendResponse).not.toHaveBeenCalled()

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS + 100)

      expect(sendResponse).toHaveBeenCalledTimes(1)
      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.id).toBe(50)
      expect(res.error.code).toBe(-32000)
      expect(res.error.message).toBe('Bridge timeout')
    })

    it('does not time out if response arrives in time', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getLatestWs()
      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 60, method: 'lite.getAccountState' })
      await interceptor.handleRequest('app.ton', data, sendResponse)

      const sent = JSON.parse(ws.send.mock.calls[0][0])
      ws.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: 'ok' }))

      // Advance past timeout -- should not trigger a second response
      await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS + 100)

      expect(sendResponse).toHaveBeenCalledTimes(1)
      const res = JSON.parse(sendResponse.mock.calls[0][0])
      expect(res.id).toBe(60)
      expect(res.result).toBe('ok')
    })
  })

  // -----------------------------------------------------------------------
  // 8. Sender cleanup on destroyed
  // -----------------------------------------------------------------------
  describe('sender cleanup on destroyed', () => {
    it('removes sender from active set when destroyed', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const sender = createMockSender()
      const sendResponse = vi.fn()

      // First request registers the sender
      const data = JSON.stringify({ id: 1, method: 'subscribe.blocks' })
      await interceptor.handleRequest('app.ton', data, sendResponse, sender)

      // Sender should have been registered (once for 'destroyed')
      expect(sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function))

      // Trigger the destroyed callback
      sender._triggerDestroyed()

      expect(store.revokeSessionPermission).toHaveBeenCalledTimes(3)

      // Second request with the same sender should re-register it
      const data2 = JSON.stringify({ id: 2, method: 'subscribe.blocks' })
      await interceptor.handleRequest('app.ton', data2, sendResponse, sender)

      // once('destroyed') should have been called again for the re-registration
      expect((sender.once as any).mock.calls.filter((c: any) => c[0] === 'destroyed').length).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // 9. WebSocket reconnection after close
  // -----------------------------------------------------------------------
  describe('WebSocket reconnection', () => {
    it('reconnects after ws close', async () => {
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const firstWs = getLatestWs()
      expect(firstWs).not.toBeNull()

      // Simulate close
      firstWs.emit('close')

      // Advance past RECONNECT_DELAY_MS (2000ms)
      await vi.advanceTimersByTimeAsync(2100)

      // A new MockWebSocket should have been created
      const secondWs = getLatestWs()
      expect(secondWs).not.toBe(firstWs)
    })

    it('coalesces concurrent rebinds to the same bridge port', async () => {
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)
      const firstWs = getLatestWs()

      const first = interceptor.applyBridgePort(7777)
      const second = interceptor.applyBridgePort(7777)

      expect(first).toBe(second)
      expect(getSockets()).toHaveLength(2)
      expect(getLatestWs().url).toBe('ws://127.0.0.1:7777')
      expect(firstWs.close).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(0)
      await first
      expect(getSockets()).toHaveLength(2)
    })

    it('records a pre-init bridge port and opens exactly one socket during idempotent init', async () => {
      await interceptor.applyBridgePort(7777)

      expect(getSockets()).toHaveLength(0)

      interceptor.init()
      interceptor.init()

      expect(getSockets()).toHaveLength(1)
      expect(getLatestWs().url).toBe('ws://127.0.0.1:7777')
      await vi.advanceTimersByTimeAsync(0)
    })

    it('calls init on permission store and clears session grants', () => {
      interceptor.init()
      expect(store.init).toHaveBeenCalledTimes(1)
      expect(store.clearSessionGrants).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Push notifications to subscribed senders
  // -----------------------------------------------------------------------
  describe('push notifications', () => {
    it('forwards push notifications to subscribed senders only', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getLatestWs()
      const sender = createMockSender()
      const sendResponse = vi.fn()

      // Subscribe the sender
      const data = JSON.stringify({ id: 1, method: 'subscribe.blocks' })
      await interceptor.handleRequest('app.ton', data, sendResponse, sender)

      // Drain the forwarded RPC response
      const sent = JSON.parse(ws.send.mock.calls[0][0])
      ws.emit('message', JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: 'subscribed' }))

      // Now simulate a push notification (no id, has method)
      const push = JSON.stringify({ jsonrpc: '2.0', method: 'subscribe.blocks', params: { block: 123 } })
      ws.emit('message', push)

      expect((sender as any).send).toHaveBeenCalledWith('bridge:message', push)
    })
  })

  // -----------------------------------------------------------------------
  // destroy() cleanup
  // -----------------------------------------------------------------------
  describe('destroy', () => {
    it('clears pending RPCs and closes ws', async () => {
      store.getPermission.mockReturnValue('granted')
      interceptor.init()
      await vi.advanceTimersByTimeAsync(0)

      const ws = getLatestWs()
      const sendResponse = vi.fn()
      const data = JSON.stringify({ id: 1, method: 'lite.getAccountState' })
      await interceptor.handleRequest('app.ton', data, sendResponse)

      interceptor.destroy()

      expect(ws.close).toHaveBeenCalled()

      // Timeout should not fire (timer was cleared)
      await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS + 100)
      expect(sendResponse).not.toHaveBeenCalled()
    })
  })
})
