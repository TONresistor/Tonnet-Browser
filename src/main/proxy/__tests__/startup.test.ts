import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { startProxySequence } from '../startup'

class ProxyMock extends EventEmitter {
  start = vi.fn<() => Promise<void>>()
}

describe('startProxySequence', () => {
  it('starts application services and releases its log listener', async () => {
    const proxy = new ProxyMock()
    proxy.start.mockResolvedValue(undefined)
    const storage = { start: vi.fn().mockResolvedValue(undefined) }
    const progress = vi.fn()

    await startProxySequence(progress, proxy as never, storage as never)

    expect(proxy.start).toHaveBeenCalledOnce()
    expect(storage.start).toHaveBeenCalledOnce()
    expect(proxy.listenerCount('log')).toBe(0)
    expect(progress).toHaveBeenLastCalledWith(4, 'Ready!')
  })

  it('releases its log listener when startup fails', async () => {
    const proxy = new ProxyMock()
    proxy.start.mockRejectedValue(new Error('failed'))
    const storage = { start: vi.fn().mockResolvedValue(undefined) }

    await expect(startProxySequence(vi.fn(), proxy as never, storage as never)).rejects.toThrow('failed')

    expect(proxy.listenerCount('log')).toBe(0)
  })
})
