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
  it('treats an already cleaned remote subscription as successfully disposed', async () => {
    const onError = vi.fn()
    const request = vi.fn(async () => {
      throw new Error('subscription not found: completed-id')
    })
    const subscriptions = new BridgeSubscriptions(request, onError)
    await expect(subscriptions.unsubscribe('completed-id')).resolves.toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('subscribe.unsubscribe', { subscription_id: 'completed-id' })
  })

  it.each(['Request timeout', 'subscription not found: other-id'])(
    'keeps genuine unsubscribe errors visible: %s',
    async (message) => {
      const onError = vi.fn()
      const error = new Error(message)
      const subscriptions = new BridgeSubscriptions(async () => {
        throw error
      }, onError)
      await subscriptions.unsubscribe('completed-id')
      expect(onError).toHaveBeenCalledWith('unsubscribe', error)
    }
  )

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
