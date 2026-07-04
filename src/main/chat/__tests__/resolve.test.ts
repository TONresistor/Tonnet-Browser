import { describe, it, expect, vi } from 'vitest'
import { WalletContractV5R1 } from '@ton/ton'
import type { DnsResolveResult } from '../../../shared/types'
import { verifyDomainOwnership, checkOwnDomain } from '../resolve'

const OWNER = WalletContractV5R1.create({ publicKey: Buffer.alloc(32, 4), workchain: 0 }).address
const OWNER_FRIENDLY = OWNER.toString({ bounceable: false })
const OTHER = WalletContractV5R1.create({ publicKey: Buffer.alloc(32, 5), workchain: 0 }).address

function rec(partial: Partial<DnsResolveResult>): DnsResolveResult {
  return {
    wallet: null,
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
    ...partial,
  }
}

const NOW = 1751500000

describe('verifyDomainOwnership', () => {
  it('accepts a domain whose wallet record is the expected address', async () => {
    const resolve = vi.fn().mockResolvedValue(rec({ wallet: OWNER.toRawString() }))
    expect(await verifyDomainOwnership('alice.ton', OWNER_FRIENDLY, resolve, NOW)).toBe(true)
  })

  it('rejects a domain owned by someone else', async () => {
    const resolve = vi.fn().mockResolvedValue(rec({ wallet: OTHER.toRawString() }))
    expect(await verifyDomainOwnership('bob.ton', OWNER_FRIENDLY, resolve, NOW)).toBe(false)
  })

  it('rejects an expired or uninitialized domain', async () => {
    const expired = vi.fn().mockResolvedValue(rec({ wallet: OWNER.toRawString(), expiring_at: NOW - 1 }))
    expect(await verifyDomainOwnership('exp.ton', OWNER_FRIENDLY, expired, NOW)).toBe(false)
    const uninit = vi.fn().mockResolvedValue(rec({ wallet: OWNER.toRawString(), initialized: false }))
    expect(await verifyDomainOwnership('new.ton', OWNER_FRIENDLY, uninit, NOW)).toBe(false)
  })

  it('rejects a non-domain nick without resolving', async () => {
    const resolve = vi.fn()
    expect(await verifyDomainOwnership('not-a-domain', OWNER_FRIENDLY, resolve, NOW)).toBe(false)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('caches and dedupes concurrent lookups', async () => {
    const resolve = vi.fn().mockResolvedValue(rec({ wallet: OWNER.toRawString() }))
    const [a, b] = await Promise.all([
      verifyDomainOwnership('cache.ton', OWNER_FRIENDLY, resolve, NOW),
      verifyDomainOwnership('cache.ton', OWNER_FRIENDLY, resolve, NOW),
    ])
    expect(a && b).toBe(true)
    await verifyDomainOwnership('cache.ton', OWNER_FRIENDLY, resolve, NOW + 60)
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('falls back to owner when there is no wallet record', async () => {
    const resolve = vi.fn().mockResolvedValue(rec({ wallet: null, owner: OWNER.toRawString() }))
    expect(await verifyDomainOwnership('owneronly.ton', OWNER_FRIENDLY, resolve, NOW)).toBe(true)
  })

  it('does not cache a transient resolver error for the full soft TTL', async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('bridge down'))
      .mockResolvedValue(rec({ wallet: OWNER.toRawString() }))
    expect(await verifyDomainOwnership('flaky.ton', OWNER_FRIENDLY, resolve, NOW)).toBe(false)
    expect(await verifyDomainOwnership('flaky.ton', OWNER_FRIENDLY, resolve, NOW + 5)).toBe(false)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(await verifyDomainOwnership('flaky.ton', OWNER_FRIENDLY, resolve, NOW + 20)).toBe(true)
    expect(resolve).toHaveBeenCalledTimes(2)
  })
})

describe('checkOwnDomain', () => {
  it('surfaces a specific reason when the domain is not owned', async () => {
    const resolve = vi.fn().mockResolvedValue(rec({ wallet: OTHER.toRawString() }))
    const res = await checkOwnDomain('bob.ton', OWNER_FRIENDLY, resolve, NOW)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/not held/i)
  })

  it('accepts an owned domain', async () => {
    const resolve = vi.fn().mockResolvedValue(rec({ wallet: OWNER.toRawString() }))
    expect((await checkOwnDomain('alice.ton', OWNER_FRIENDLY, resolve, NOW)).ok).toBe(true)
  })
})
