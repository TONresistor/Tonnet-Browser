import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeEventBus } from '../bridge-event-bus'
import { BridgeTransactionWatcher } from '../bridge-transaction-watcher'
import { beginCell } from '@ton/core'

const MESSAGE = beginCell().endCell()
const BOC = MESSAGE.toBoc()
const HASH = MESSAGE.hash().toString('hex')

function setup(timeoutMs = 1_000) {
  const bus = new BridgeEventBus(vi.fn())
  const unsubscribe = vi.fn(async () => {})
  const request = vi.fn(async () => ({ subscription_id: 'sub', msg_hash: HASH }))
  const watcher = new BridgeTransactionWatcher(
    request,
    { on: (event, callback) => bus.on(event, callback), unsubscribe },
    timeoutMs
  )
  return { bus, unsubscribe, watcher, request }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('BridgeTransactionWatcher', () => {
  it('keeps a matching confirmation that arrives before the RPC acknowledgement', async () => {
    const { bus, watcher, request, unsubscribe } = setup()
    let acknowledge!: (value: { subscription_id: string; msg_hash: string }) => void
    request.mockImplementationOnce(() => new Promise((resolve) => (acknowledge = resolve)))
    const submitted = vi.fn(async () => {})
    const sending = watcher.sendAndWatch(BOC, submitted)
    bus.emit('tx_confirmed', { msg_hash: HASH, transaction: { hash: 'tx-hash' } })
    acknowledge({ subscription_id: 'sub', msg_hash: HASH })
    await expect(sending).resolves.toBe('tx-hash')
    expect(submitted).toHaveBeenCalledWith(HASH)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('observes confirmation before awaiting durable acknowledgement and preserves the receipt', async () => {
    const { bus, watcher } = setup()
    let release!: () => void
    const acknowledged = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const receipt = {
      account: {
        address: `0:${'11'.repeat(32)}`,
        status: 'active',
        code_hash: '22'.repeat(32),
        data_boc: 'data',
        last_tx_lt: '100',
        last_tx_hash: '33'.repeat(32),
      },
      masterchain: {
        workchain: -1,
        shard: '8000000000000000',
        seqno: 42,
        root_hash: '44'.repeat(32),
        file_hash: '55'.repeat(32),
      },
      transactions: [{ hash: '33'.repeat(32), lt: '100', now: 1000, boc: 'original-cell' }],
    }
    const done = vi.fn()
    const sending = watcher.sendAndWatch(BOC, acknowledged).then((result) => {
      done()
      return result
    })
    await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledWith(HASH))
    bus.emit('tx_confirmed', { msg_hash: HASH, transaction: { hash: 'tx-hash' }, receipt })
    await Promise.resolve()
    expect(done).not.toHaveBeenCalled()
    release()
    await expect(sending).resolves.toEqual(receipt)
    expect(bus.listenerCount('tx_confirmed')).toBe(0)
  })

  it('keeps malformed receipt data as a confirmation hint for normal reconciliation', async () => {
    const { bus, watcher } = setup()
    const sending = watcher.sendAndWatch(BOC)
    await vi.waitFor(() => expect(bus.listenerCount('tx_confirmed')).toBe(1))
    bus.emit('tx_confirmed', { msg_hash: HASH, transaction: { hash: 'tx-hash' }, receipt: { invalid: true } })
    await expect(sending).resolves.toBe('tx-hash')
  })

  it('preserves an acknowledgement failure even if confirmation arrived first', async () => {
    const { bus, watcher, unsubscribe } = setup()
    let reject!: (error: Error) => void
    const sending = watcher.sendAndWatch(BOC, () => new Promise((_, fail) => (reject = fail)))
    const rejected = expect(sending).rejects.toThrow('Disk full')
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
    bus.emit('tx_confirmed', { msg_hash: HASH, transaction: { hash: 'tx-hash' } })
    reject(new Error('Disk full'))
    await rejected
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('settles once on matching confirmation and cleans the remote subscription', async () => {
    const { bus, unsubscribe, watcher } = setup()
    const result = watcher.sendAndWatch(BOC)
    await vi.waitFor(() => expect(bus.listenerCount('tx_confirmed')).toBe(1))
    bus.emit('tx_confirmed', { msg_hash: 'other' })
    bus.emit('tx_confirmed', { msg_hash: HASH, transaction: { hash: 'tx-hash' } })
    bus.emit('tx_timeout', { msg_hash: HASH, reason: 'late' })
    await expect(result).resolves.toBe('tx-hash')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(bus.listenerCount('tx_confirmed')).toBe(0)
  })

  it('rejects all active watches immediately on disconnect', async () => {
    const { bus, unsubscribe, watcher } = setup()
    const result = watcher.sendAndWatch(BOC)
    await vi.waitFor(() => expect(bus.listenerCount('tx_confirmed')).toBe(1))
    watcher.rejectAll(new Error('Connection lost'))
    bus.emit('tx_confirmed', { msg_hash: HASH })
    await expect(result).rejects.toThrow('Connection lost')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('uses a bounded confirmation timeout', async () => {
    vi.useFakeTimers()
    const { watcher } = setup(50)
    const result = watcher.sendAndWatch(BOC)
    const rejection = expect(result).rejects.toThrow('Transaction confirmation timeout (50ms)')
    await vi.advanceTimersByTimeAsync(50)
    await rejection
  })
})
