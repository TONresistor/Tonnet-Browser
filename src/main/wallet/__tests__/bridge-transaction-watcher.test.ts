import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeEventBus } from '../bridge-event-bus'
import { BridgeTransactionWatcher } from '../bridge-transaction-watcher'

function setup(timeoutMs = 1_000) {
  const bus = new BridgeEventBus(vi.fn())
  const unsubscribe = vi.fn(async () => {})
  const watcher = new BridgeTransactionWatcher(
    async () => ({ subscription_id: 'sub', msg_hash: 'message-hash' }),
    { on: (event, callback) => bus.on(event, callback), unsubscribe },
    timeoutMs
  )
  return { bus, unsubscribe, watcher }
}

afterEach(() => vi.useRealTimers())

describe('BridgeTransactionWatcher', () => {
  it('settles once on matching confirmation and cleans the remote subscription', async () => {
    const { bus, unsubscribe, watcher } = setup()
    const result = watcher.sendAndWatch(Buffer.from('boc'))
    await vi.waitFor(() => expect(bus.listenerCount('tx_confirmed')).toBe(1))
    bus.emit('tx_confirmed', { msg_hash: 'other' })
    bus.emit('tx_confirmed', { msg_hash: 'message-hash', transaction: { hash: 'tx-hash' } })
    bus.emit('tx_timeout', { msg_hash: 'message-hash', reason: 'late' })
    await expect(result).resolves.toBe('tx-hash')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(bus.listenerCount('tx_confirmed')).toBe(0)
  })

  it('rejects all active watches immediately on disconnect', async () => {
    const { bus, unsubscribe, watcher } = setup()
    const result = watcher.sendAndWatch(Buffer.from('boc'))
    await vi.waitFor(() => expect(bus.listenerCount('tx_confirmed')).toBe(1))
    watcher.rejectAll(new Error('Connection lost'))
    bus.emit('tx_confirmed', { msg_hash: 'message-hash' })
    await expect(result).rejects.toThrow('Connection lost')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('uses a bounded confirmation timeout', async () => {
    vi.useFakeTimers()
    const { watcher } = setup(50)
    const result = watcher.sendAndWatch(Buffer.from('boc'))
    const rejection = expect(result).rejects.toThrow('Transaction confirmation timeout (50ms)')
    await vi.advanceTimersByTimeAsync(50)
    await rejection
  })
})
