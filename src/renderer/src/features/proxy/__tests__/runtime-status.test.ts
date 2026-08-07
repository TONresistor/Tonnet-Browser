import { describe, expect, it, vi } from 'vitest'
import type { ProxyStatusEvent } from '@shared/ipc-events'
import { subscribeProxyRuntimeStatus } from '../runtime-status'

describe('proxy runtime status subscription', () => {
  it('hydrates from the current runtime snapshot', async () => {
    const apply = vi.fn()
    const client = {
      onStatus: vi.fn(() => vi.fn()),
      status: vi.fn().mockResolvedValue({ status: 'connected', connected: true, port: 8080 }),
    }

    const dispose = subscribeProxyRuntimeStatus(client, apply, vi.fn())
    await Promise.resolve()
    await Promise.resolve()

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }))
    dispose()
  })

  it('subscribes before loading the snapshot and keeps the newest event', async () => {
    const order: string[] = []
    let listener: (status: ProxyStatusEvent) => void = () => {}
    let resolveStatus: (status: unknown) => void = () => {}
    const status = new Promise<unknown>((resolve) => {
      resolveStatus = resolve
    })
    const client = {
      onStatus: vi.fn((next: typeof listener) => {
        order.push('subscribe')
        listener = next
        return vi.fn()
      }),
      status: vi.fn(() => {
        order.push('snapshot')
        return status
      }),
    }
    const apply = vi.fn()

    const dispose = subscribeProxyRuntimeStatus(client, apply, vi.fn())
    listener({ status: 'connected', connected: true, port: 8080 })
    resolveStatus({ status: 'stopped', connected: false, port: 8080 })
    await status
    await Promise.resolve()

    expect(order).toEqual(['subscribe', 'snapshot'])
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ status: 'connected' }))

    dispose()
  })

  it('unsubscribes and ignores a late snapshot', async () => {
    let resolveStatus: (status: unknown) => void = () => {}
    const unsubscribe = vi.fn()
    const status = new Promise<unknown>((resolve) => {
      resolveStatus = resolve
    })
    const client = {
      onStatus: vi.fn(() => unsubscribe),
      status: vi.fn(() => status),
    }
    const apply = vi.fn()

    const dispose = subscribeProxyRuntimeStatus(client, apply, vi.fn())
    dispose()
    resolveStatus({ status: 'connected', connected: true, port: 8080 })
    await status
    await Promise.resolve()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(apply).not.toHaveBeenCalled()
  })
})
