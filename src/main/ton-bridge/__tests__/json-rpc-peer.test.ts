import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonRpcRequestTracker } from '../json-rpc-peer'

describe('JsonRpcRequestTracker', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves a correlated response and ignores a duplicate', async () => {
    const tracker = new JsonRpcRequestTracker()
    const pending = tracker.wait('1', 'wallet.test', 1_000)

    expect(tracker.settle({ id: '1', result: { ok: true } })).toBe(true)
    expect(tracker.settle({ id: '1', result: { ok: false } })).toBe(false)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(tracker.size).toBe(0)
  })

  it('rejects RPC errors with the remote message', async () => {
    const tracker = new JsonRpcRequestTracker()
    const pending = tracker.wait('2', 'wallet.test', 1_000)
    tracker.settle({ id: 2, error: { code: -1, message: 'denied' } })
    await expect(pending).rejects.toThrow('denied')
  })

  it('times out once and ignores a late response', async () => {
    vi.useFakeTimers()
    const tracker = new JsonRpcRequestTracker()
    const pending = tracker.wait('3', 'wallet.slow', 100)

    const rejection = expect(pending).rejects.toThrow('Request timeout: wallet.slow')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(tracker.settle({ id: '3', result: 'late' })).toBe(false)
  })

  it('rejects all requests exactly once on disconnect', async () => {
    const tracker = new JsonRpcRequestTracker()
    const first = tracker.wait('4', 'one', 1_000)
    const second = tracker.wait('5', 'two', 1_000)

    tracker.rejectAll(new Error('Connection lost'))
    tracker.rejectAll(new Error('second failure'))

    await expect(first).rejects.toThrow('Connection lost')
    await expect(second).rejects.toThrow('Connection lost')
    expect(tracker.size).toBe(0)
  })
})
