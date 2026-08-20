import { Address } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import type { DnsResolveResult } from '../../../shared/types'
import { WalletQueryService, type WalletQueryBridge } from '../query-service'

const RAW = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

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
    const service = new WalletQueryService(() =>
      bridge({ resolveDomain: vi.fn(() => Promise.resolve(dns({ wallet: null }))) })
    )
    await expect(service.resolveRecipient('alice.ton')).rejects.toThrow('Domain has no wallet or owner')
    await expect(service.resolveRecipient('café.ton')).rejects.toThrow('Non-ASCII')
  })

  it('rejects testnet-only addresses returned directly or through DNS', async () => {
    const testOnly = Address.parseRaw(RAW).toString({ bounceable: false, testOnly: true })
    const service = new WalletQueryService(() =>
      bridge({ resolveDomain: vi.fn(() => Promise.resolve(dns({ wallet: testOnly }))) })
    )
    await expect(service.resolveRecipient(testOnly)).rejects.toThrow('Testnet address not allowed')
    await expect(service.resolveRecipient('alice.ton')).rejects.toThrow('Testnet address not allowed')
  })

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
})
