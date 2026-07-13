import { describe, expect, it, vi } from 'vitest'
import { ProxyAutoConnector } from '../auto-connect'

describe('ProxyAutoConnector', () => {
  it('shares one startup across concurrent windows and skips an active runtime', async () => {
    let running = false
    let resolveStart: () => void = () => {}
    const start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = () => {
            running = true
            resolve()
          }
        })
    )
    const connector = new ProxyAutoConnector(start, () => running)

    const first = connector.connect()
    const second = connector.connect()
    await Promise.resolve()

    expect(second).toBe(first)
    expect(start).toHaveBeenCalledOnce()

    resolveStart()
    const third = connector.connect()
    expect(third).toBe(first)
    await Promise.all([first, second, third])
    await connector.connect()

    expect(start).toHaveBeenCalledOnce()
  })

  it('allows a retry after startup fails', async () => {
    const start = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined)
    const connector = new ProxyAutoConnector(start, () => false)

    await expect(connector.connect()).rejects.toThrow('failed')
    await expect(connector.connect()).resolves.toBeUndefined()

    expect(start).toHaveBeenCalledTimes(2)
  })
})
