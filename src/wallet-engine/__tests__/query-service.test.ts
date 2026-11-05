import { Address, beginCell } from '@ton/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DnsResolveResult } from '../schemas'
import { WalletQueryService, type WalletQueryBridge } from '../query-service'

const RAW = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = `0:${'bb'.repeat(32)}`
afterEach(() => vi.restoreAllMocks())

function dns(overrides: Partial<DnsResolveResult> = {}): DnsResolveResult {
  return {
    wallet: RAW,
    site_adnl: null,
    has_storage: false,
    storage_bag_id: null,
    next_resolver: null,
    owner: null,
    nft_address: null,
    collection: null,
    editor: null,
    initialized: true,
    expiring_at: null,
    ...overrides,
  }
}

function bridge(overrides: Partial<WalletQueryBridge> = {}): WalletQueryBridge {
  return {
    getBalance: vi.fn(() => Promise.resolve('10')),
    getTransactions: vi.fn(() => Promise.resolve([])),
    resolveDomain: vi.fn(() => Promise.resolve(dns())),
    ...overrides,
  }
}

describe('WalletQueryService', () => {
  it('returns the current balance when no bridge is available', async () => {
    const service = new WalletQueryService(() => null)
    await expect(service.getBalance(RAW, '7')).resolves.toBe('7')
  })

  it('resolves and normalizes TON domains', async () => {
    const adapter = bridge()
    const service = new WalletQueryService(() => adapter)
    await expect(service.resolveRecipient(' ALICE.TON ')).resolves.toEqual({ address: RAW, domain: 'alice.ton' })
    expect(adapter.resolveDomain).toHaveBeenCalledWith('alice.ton')
  })

  it('rejects unsafe or unusable domain results', async () => {
    const adapter = bridge({ resolveDomain: vi.fn(() => Promise.resolve(dns({ wallet: null }))) })
    const service = new WalletQueryService(() => adapter)
    await expect(service.resolveRecipient('alice.ton')).rejects.toThrow('Domain has no wallet or owner')
    await expect(service.resolveRecipient('café.ton')).rejects.toThrow('Non-ASCII')
  })

  it('rejects testnet-only addresses returned directly or through DNS', async () => {
    const testOnly = Address.parseRaw(RAW).toString({ bounceable: false, testOnly: true })
    const adapter = bridge({ resolveDomain: vi.fn(() => Promise.resolve(dns({ wallet: testOnly }))) })
    const service = new WalletQueryService(() => adapter)
    await expect(service.resolveRecipient(testOnly)).rejects.toThrow('Testnet address not allowed')
    await expect(service.resolveRecipient('alice.ton')).rejects.toThrow('Testnet address not allowed')
  })

  it('reuses a validated UI resolution for ten seconds and returns independent values', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const adapter = bridge()
    const service = new WalletQueryService(() => adapter)
    const first = await service.resolveRecipient(' ALICE.TON ')
    first.address = OTHER
    await expect(service.resolveRecipient('alice.ton')).resolves.toEqual({ address: RAW, domain: 'alice.ton' })
    expect(adapter.resolveDomain).toHaveBeenCalledOnce()
    now = 10_000
    vi.mocked(adapter.resolveDomain).mockResolvedValueOnce(dns({ wallet: OTHER }))
    await expect(service.resolveRecipient('alice.ton')).resolves.toEqual({ address: OTHER, domain: 'alice.ton' })
    expect(adapter.resolveDomain).toHaveBeenCalledTimes(2)
  })

  it('does not reuse a cached record past the registration expiry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const adapter = bridge({ resolveDomain: vi.fn(async () => dns({ expiring_at: 1001 })) })
    const service = new WalletQueryService(() => adapter)
    await service.resolveRecipient('alice.ton')
    vi.mocked(Date.now).mockReturnValue(1_002_000)
    await expect(service.resolveRecipient('alice.ton')).rejects.toThrow('Domain expired')
    expect(adapter.resolveDomain).toHaveBeenCalledTimes(2)
  })

  it('does not cache invalid results or confuse different names', async () => {
    const adapter = bridge()
    vi.mocked(adapter.resolveDomain).mockResolvedValueOnce(dns({ wallet: null }))
    const service = new WalletQueryService(() => adapter)
    await expect(service.resolveRecipient('alice.ton')).rejects.toThrow('Domain has no wallet or owner')
    await service.resolveRecipient('alice.ton')
    await service.resolveRecipient('bob.ton')
    expect(adapter.resolveDomain).toHaveBeenCalledTimes(3)
  })

  it('does not let an older successful lookup replace a newer cached resolution', async () => {
    const adapter = bridge()
    let finish!: (value: DnsResolveResult) => void
    vi.mocked(adapter.resolveDomain)
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValueOnce(dns({ wallet: OTHER }))
    const service = new WalletQueryService(() => adapter)
    const old = service.resolveRecipient('alice.ton')
    await service.resolveRecipient('alice.ton')
    finish(dns())
    await expect(old).resolves.toEqual({ address: RAW, domain: 'alice.ton' })
    await expect(service.resolveRecipient('alice.ton')).resolves.toEqual({ address: OTHER, domain: 'alice.ton' })
    expect(adapter.resolveDomain).toHaveBeenCalledTimes(2)
  })

  it.each(['connection', 'clear', 'replacement'])(
    'rejects late DNS results and preserves the new cache after %s changes',
    async (change) => {
      let revision = 0
      const adapter = bridge({ getConnectionRevision: () => revision })
      const replacement = bridge({ resolveDomain: vi.fn(async () => dns({ wallet: OTHER })) })
      let current = adapter
      let finish!: (value: DnsResolveResult) => void
      vi.mocked(adapter.resolveDomain).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      const service = new WalletQueryService(() => current)
      const old = service.resolveRecipient('alice.ton')
      const rejected = expect(old).rejects.toThrow('Bridge not connected')
      if (change === 'connection') revision++
      if (change === 'clear') service.clearRecipientCache()
      if (change === 'replacement') current = replacement
      else vi.mocked(adapter.resolveDomain).mockResolvedValueOnce(dns({ wallet: OTHER }))
      await service.resolveRecipient('alice.ton')
      finish(dns())
      await rejected
      await expect(service.resolveRecipient('alice.ton')).resolves.toEqual({ address: OTHER, domain: 'alice.ton' })
      expect(current.resolveDomain).toHaveBeenCalledTimes(change === 'replacement' ? 1 : 2)
    }
  )

  it('converts bridge transactions and rejects malformed timestamps', () => {
    const service = new WalletQueryService(() => bridge())
    expect(
      service.convertRawTransaction({
        hash: 'hash',
        lt: '1',
        now: 10,
        in_msg: { source: RAW, destination: RAW, value: '5' },
      })
    ).toMatchObject({ id: 'hash', type: 'receive', amount: '5', timestamp: 10_000 })
    expect(service.convertRawTransaction({ hash: 'hash', lt: '1', now: 0 })).toBeNull()
  })

  it('keeps an encrypted message body and its sender for explicit decryption', () => {
    const service = new WalletQueryService(() => bridge())
    const body = beginCell()
      .storeUint(0x2167da4b, 32)
      .storeBuffer(Buffer.alloc(64))
      .endCell()
      .toBoc()
      .toString('base64')
    const transaction = service.convertRawTransaction({
      hash: 'encrypted',
      lt: '1',
      now: 10,
      in_msg: { source: RAW, destination: RAW, value: '1', body },
    })
    expect(transaction).toMatchObject({ commentEncrypted: true, encryptedComment: { sender: RAW, body } })
    expect(transaction?.comment).toBeUndefined()
  })
})
