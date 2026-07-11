import { describe, expect, it, vi } from 'vitest'
import { BridgeSubscriptions } from '../bridge-subscriptions'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('BridgeSubscriptions', () => {
  it('delivers events and unsubscribes the current server id', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'subscribe.unsubscribe' ? {} : { subscription_id: 'sub-1' }
    )
    const subscriptions = new BridgeSubscriptions(request, vi.fn())
    const callback = vi.fn()
    const dispose = subscriptions.subscribe('subscribe.transactions', { address: '0:abc' }, 'transaction', callback)
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    subscriptions.emit('transaction', { id: 1 })
    expect(callback).toHaveBeenCalledWith({ id: 1 })
    dispose()
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('subscribe.unsubscribe', { subscription_id: 'sub-1' }))
  })

  it('unsubscribes a late response when disposed during registration', async () => {
    const response = deferred<unknown>()
    const request = vi.fn((method: string) =>
      method === 'subscribe.unsubscribe' ? Promise.resolve({}) : response.promise
    )
    const subscriptions = new BridgeSubscriptions(request, vi.fn())
    const dispose = subscriptions.subscribe('subscribe.accountState', {}, 'account_state', vi.fn())
    dispose()
    response.resolve({ subscription_id: 'late-id' })
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('subscribe.unsubscribe', { subscription_id: 'late-id' })
    )
  })

  it('resubscribes idempotently and makes the original disposer target the new id', async () => {
    let nextId = 0
    const request = vi.fn(async (method: string) =>
      method === 'subscribe.unsubscribe' ? {} : { subscription_id: `sub-${++nextId}` }
    )
    const subscriptions = new BridgeSubscriptions(request, vi.fn())
    const dispose = subscriptions.subscribe('subscribe.transactions', {}, 'transaction', vi.fn())
    await vi.waitFor(() => expect(nextId).toBe(1))
    await Promise.all([subscriptions.resubscribeAll(), subscriptions.resubscribeAll()])
    expect(nextId).toBe(2)
    dispose()
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('subscribe.unsubscribe', { subscription_id: 'sub-2' }))
  })
})
