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

  it('sends typed overlay queries with a bounded request timeout', async () => {
    const request = vi.fn(async () => ({ data: 'response' }))
    const overlay = new BridgeOverlayClient(request, { on: () => () => {} })
    await expect(overlay.query('overlay', 'query', 3)).resolves.toBe('response')
    expect(request).toHaveBeenCalledWith('overlay.query', { overlay_id: 'overlay', data: 'query', timeout: 3 }, 4_000)
  })

  it('disconnects the ADNL peer when joining its overlay fails', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'adnl.connectByADNL') return { peer_id: 'peer' }
      if (method === 'overlay.join') throw new Error('join failed')
      return {}
    })
    const overlay = new BridgeOverlayClient(request, { on: () => () => {} })
    await expect(overlay.connectAndJoin('anchor', 'overlay')).rejects.toThrow('join failed')
    expect(request).toHaveBeenCalledWith('adnl.disconnect', { peer_id: 'peer' })
  })

  it('allows cold ADNL discovery and retries one connection timeout', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timeout: adnl.connectByADNL'))
      .mockResolvedValueOnce({ peer_id: 'peer' })
      .mockResolvedValueOnce({})
    const overlay = new BridgeOverlayClient(request, { on: () => () => {} })

    await expect(overlay.connectAndJoin('anchor', 'overlay')).resolves.toBe('peer')
    expect(request).toHaveBeenNthCalledWith(1, 'adnl.connectByADNL', { adnl_id: 'anchor' }, 20_000)
    expect(request).toHaveBeenNthCalledWith(2, 'adnl.connectByADNL', { adnl_id: 'anchor' }, 20_000)
    expect(request).toHaveBeenNthCalledWith(3, 'overlay.join', { overlay_id: 'overlay', peer_id: 'peer' })
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

  it('validates the verified overlay-node discovery response', async () => {
    const request = vi.fn(async () => ({
      nodes: [{ id: 'pub', adnl_id: 'adnl', overlay: 'overlay', version: 123 }],
      count: 1,
    }))
    const dht = new BridgeDhtClient(request, vi.fn())
    await expect(dht.findOverlayNodes('room')).resolves.toMatchObject({
      nodes: [{ adnl_id: 'adnl' }],
      count: 1,
    })
    expect(request).toHaveBeenCalledWith('dht.findOverlayNodes', { overlay_key: 'room' }, 22_000)
  })
})
