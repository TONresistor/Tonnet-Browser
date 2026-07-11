import { describe, expect, it, vi } from 'vitest'
import { BridgeDhtClient, BridgeDnsClient, BridgeOverlayClient } from '../bridge-capabilities'

describe('bridge capability clients', () => {
  it('normalizes a validated DNS response', async () => {
    const dns = new BridgeDnsClient(async () => ({ site: 'adnl', storage: true, bag_id: 'bag', extension: 1 }))
    await expect(dns.resolve('site.ton')).resolves.toMatchObject({
      site_adnl: 'adnl',
      has_storage: true,
      storage_bag_id: 'bag',
      initialized: true,
      extension: 1,
    })
  })

  it('preserves overlay.sendRaw wire method and validates pushed messages', async () => {
    const request = vi.fn(async (method: string) => (method === 'adnl.connectByADNL' ? { peer_id: 'peer' } : {}))
    let listener: ((data: unknown) => void) | undefined
    const overlay = new BridgeOverlayClient(request, {
      on: (_event, callback) => {
        listener = callback
        return () => {}
      },
    })
    await overlay.sendRaw('overlay', 'payload')
    expect(request).toHaveBeenCalledWith('overlay.sendRaw', { overlay_id: 'overlay', data: 'payload' })
    const callback = vi.fn()
    overlay.onMessage(callback)
    listener?.({ overlay_id: 'overlay', message: 'payload', trusted: true })
    expect(callback).toHaveBeenCalledWith({ overlay_id: 'overlay', message: 'payload', trusted: true })
    expect(() => listener?.({ overlay_id: 'overlay', message: 1 })).toThrow()
  })

  it('retries transient DHT failures but not semantic not-found', async () => {
    const warn = vi.fn()
    const transient = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: 'value', ttl: 10 })
    const dht = new BridgeDhtClient(transient, warn)
    await expect(dht.findValue('key', 'name')).resolves.toEqual({ data: 'value', ttl: 10 })
    expect(transient).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()

    const missing = new BridgeDhtClient(async () => {
      throw new Error('not found')
    }, warn)
    await expect(missing.findValue('key', 'name')).resolves.toBeNull()
  })
})
