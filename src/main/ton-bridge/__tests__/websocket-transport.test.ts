import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { WebSocketTransport } from '../websocket-transport'

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING
  send = vi.fn((_message: string, callback: (error?: Error) => void) => callback())
  ping = vi.fn()
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED
  })
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED
    this.emit('close', 1006, Buffer.from('terminated'))
  })
  open(): void {
    this.readyState = WebSocket.OPEN
    this.emit('open')
  }
}

function setup() {
  const sockets: FakeSocket[] = []
  const hooks = {
    onMessage: vi.fn(),
    onSocketOpen: vi.fn(async () => {}),
    onReady: vi.fn(),
    onDisconnect: vi.fn(),
    onError: vi.fn(),
    onReconnectScheduled: vi.fn(),
  }
  const transport = new WebSocketTransport(
    'ws://127.0.0.1:1',
    hooks,
    { heartbeatIntervalMs: 100, pongTimeoutMs: 20, reconnectBaseMs: 10, reconnectMaxMs: 40 },
    () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }
  )
  return { hooks, sockets, transport }
}

afterEach(() => vi.useRealTimers())

describe('WebSocketTransport', () => {
  it('coalesces connect and marks ready only after the readiness hook', async () => {
    const { hooks, sockets, transport } = setup()
    const first = transport.connect()
    const second = transport.connect()
    expect(first).toBe(second)
    expect(sockets).toHaveLength(1)
    sockets[0].open()
    await first
    expect(hooks.onSocketOpen).toHaveBeenCalledOnce()
    expect(hooks.onReady).toHaveBeenCalledWith(false)
    expect(transport.isConnected()).toBe(true)
  })

  it('settles an in-flight connect when stopped before open', async () => {
    const { sockets, transport } = setup()
    const connection = transport.connect()
    const rejection = expect(connection).rejects.toThrow('Transport stopped')
    transport.stop()
    await rejection
    expect(sockets[0].close).toHaveBeenCalledOnce()
    expect(transport.currentState()).toBe('stopped')
  })

  it('reconnects with backoff after an unexpected close', async () => {
    vi.useFakeTimers()
    const { hooks, sockets, transport } = setup()
    const connected = transport.connect()
    sockets[0].open()
    await connected
    sockets[0].emit('close', 1006, Buffer.from('lost'))
    expect(hooks.onDisconnect).toHaveBeenCalledOnce()
    expect(hooks.onReconnectScheduled).toHaveBeenCalledWith(10, 1)
    await vi.advanceTimersByTimeAsync(10)
    expect(sockets).toHaveLength(2)
    sockets[1].open()
    await vi.waitFor(() => expect(hooks.onReady).toHaveBeenLastCalledWith(true))
  })

  it('cancels a scheduled reconnect when an explicit connect starts', async () => {
    vi.useFakeTimers()
    const { hooks, sockets, transport } = setup()
    const connected = transport.connect()
    sockets[0].open()
    await connected
    sockets[0].emit('close', 1006, Buffer.from('lost'))

    const reconnecting = transport.connect()
    expect(sockets).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(10)
    expect(sockets).toHaveLength(2)

    sockets[1].open()
    await reconnecting
    expect(hooks.onReady).toHaveBeenLastCalledWith(true)
  })

  it('shares the reconnect flight with explicit connect callers', async () => {
    vi.useFakeTimers()
    const { sockets, transport } = setup()
    const connected = transport.connect()
    sockets[0].open()
    await connected
    sockets[0].emit('close', 1006, Buffer.from('lost'))

    await vi.advanceTimersByTimeAsync(10)
    expect(sockets).toHaveLength(2)
    const first = transport.connect()
    const second = transport.connect()
    expect(first).toBe(second)
    expect(sockets).toHaveLength(2)

    sockets[1].open()
    await first
  })

  it('terminates a socket that misses its heartbeat pong and stop cancels reconnect', async () => {
    vi.useFakeTimers()
    const { sockets, transport } = setup()
    const connected = transport.connect()
    sockets[0].open()
    await connected
    await vi.advanceTimersByTimeAsync(120)
    expect(sockets[0].ping).toHaveBeenCalledOnce()
    expect(sockets[0].terminate).toHaveBeenCalledOnce()
    transport.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(sockets).toHaveLength(1)
    expect(transport.currentState()).toBe('stopped')
  })
})
