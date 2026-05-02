/**
 * Unit tests for cocoon/stake-cache.ts.
 * Uses a temp dir as the basePath so we exercise the real fs path without
 * depending on electron's app.getPath('userData').
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { StakeCacheStore } from '../stake-cache'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'cocoon-stake-cache-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('StakeCacheStore — addresses', () => {
  it('returns null when no file exists', async () => {
    const store = new StakeCacheStore(dir)
    expect(await store.load()).toBeNull()
  })

  it('persists and reads back addresses', async () => {
    const store = new StakeCacheStore(dir)
    await store.save({
      proxySCAddress: 'EQA',
      clientSCAddress: 'EQB',
      ownerAddress: 'EQC',
      cachedAt: 123,
    })
    const fresh = new StakeCacheStore(dir)
    const loaded = await fresh.load()
    expect(loaded).toEqual({
      proxySCAddress: 'EQA',
      clientSCAddress: 'EQB',
      ownerAddress: 'EQC',
      cachedAt: 123,
    })
  })

  it('creates the cache directory before saving', async () => {
    const nested = join(dir, 'missing', 'nested')
    const store = new StakeCacheStore(nested)
    await store.save({
      proxySCAddress: 'EQA',
      clientSCAddress: 'EQB',
      ownerAddress: 'EQC',
      cachedAt: 123,
    })

    const fresh = new StakeCacheStore(nested)
    expect(await fresh.load()).toMatchObject({
      proxySCAddress: 'EQA',
      clientSCAddress: 'EQB',
      ownerAddress: 'EQC',
    })
  })

  it('clear() removes the file', async () => {
    const store = new StakeCacheStore(dir)
    await store.save({ proxySCAddress: 'EQA', clientSCAddress: 'EQB', ownerAddress: 'EQC', cachedAt: 1 })
    await store.clear()
    expect(await store.load()).toBeNull()
  })

  it('saveStakeAddresses preserves a pending withdraw action marker', async () => {
    const store = new StakeCacheStore(dir)
    await store.setPendingWithdraw({
      startedAt: 42,
      lastActionAt: 100,
      lastBocHash: 'boc',
    })
    await store.saveStakeAddresses({
      proxySCAddress: 'EQA',
      clientSCAddress: 'EQB',
      ownerAddress: 'EQC',
      cachedAt: 123,
    })

    const fresh = new StakeCacheStore(dir)
    const loaded = await fresh.load()
    expect(loaded).toMatchObject({
      proxySCAddress: 'EQA',
      clientSCAddress: 'EQB',
      ownerAddress: 'EQC',
      pendingWithdraw: {
        startedAt: 42,
        lastActionAt: 100,
        lastBocHash: 'boc',
      },
    })
  })
})

describe('StakeCacheStore — pendingWithdraw', () => {
  it('getPendingWithdraw returns null when no cache exists', async () => {
    const store = new StakeCacheStore(dir)
    expect(await store.getPendingWithdraw()).toBeNull()
  })

  it('getPendingWithdraw returns null when cache exists but flag absent', async () => {
    const store = new StakeCacheStore(dir)
    await store.save({ proxySCAddress: 'EQA', clientSCAddress: 'EQB', ownerAddress: 'EQC', cachedAt: 1 })
    expect(await store.getPendingWithdraw()).toBeNull()
  })

  it('setPendingWithdraw preserves existing addresses', async () => {
    const store = new StakeCacheStore(dir)
    await store.save({ proxySCAddress: 'EQA', clientSCAddress: 'EQB', ownerAddress: 'EQC', cachedAt: 1 })
    await store.setPendingWithdraw({ startedAt: 999 })

    const fresh = new StakeCacheStore(dir)
    const loaded = await fresh.load()
    expect(loaded?.proxySCAddress).toBe('EQA')
    expect(loaded?.pendingWithdraw).toEqual({ startedAt: 999 })
  })

  it('setPendingWithdraw works with no prior cache', async () => {
    const store = new StakeCacheStore(dir)
    await store.setPendingWithdraw({ startedAt: 42 })

    const fresh = new StakeCacheStore(dir)
    const loaded = await fresh.load()
    expect(loaded?.pendingWithdraw).toEqual({ startedAt: 42 })
    expect(loaded?.proxySCAddress).toBeUndefined()
  })

  it('clearPendingWithdraw nulls the flag without touching addresses', async () => {
    const store = new StakeCacheStore(dir)
    await store.save({ proxySCAddress: 'EQA', clientSCAddress: 'EQB', ownerAddress: 'EQC', cachedAt: 1 })
    await store.setPendingWithdraw({ startedAt: 42 })
    await store.clearPendingWithdraw()

    const fresh = new StakeCacheStore(dir)
    const loaded = await fresh.load()
    expect(loaded?.pendingWithdraw).toBeNull()
    expect(loaded?.proxySCAddress).toBe('EQA')
  })

  it('clearPendingWithdraw is a no-op when there is no flag', async () => {
    const store = new StakeCacheStore(dir)
    await store.clearPendingWithdraw()
    // Should not have created a file out of thin air
    expect(await store.load()).toBeNull()
  })
})
