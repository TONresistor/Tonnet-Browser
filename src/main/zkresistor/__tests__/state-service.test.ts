import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Address } from '@ton/core'
import { afterEach, expect, it, vi } from 'vitest'
import { FileMerkleStateStore } from '../state-store'

const poolAddress = Address.parseRaw(`0:${'11'.repeat(32)}`).toString()
const mocks = vi.hoisted(() => ({
  source: {
    eventsAfter: vi.fn(async () => ({
      events: [],
      scannedThrough: { transactionLt: 100n, eventIndex: 0, blockSeqno: 1 },
    })),
  },
}))
vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
vi.mock('../../../shared/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('../resources', () => ({ loadZkResistorResource: vi.fn(async () => Buffer.alloc(0)) }))
vi.mock('../catalog-service', () => ({
  ZkResistorCatalogService: class {
    async load() {
      return { pools: [{ address: Address.parseRaw(`0:${'11'.repeat(32)}`).toString() }] }
    }
  },
}))
vi.mock('@tonresistor/zkresistor-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tonresistor/zkresistor-sdk')>()),
  createPoseidon2: () => async () => 0n,
  createClientEventSource: () => mocks.source,
  TonPool: {
    createStateChainReader: () => ({
      getMerkleHead: async () => ({ nextIndex: 0, withdrawalCount: 0, currentRoot: 0n }),
      getSparseRoot: async () => 0n,
    }),
  },
}))
import { ZkResistorStateService, ZkResistorSyncIncompleteError } from '../state-service'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'zkr-state-service-'))
  roots.push(root)
  const bridge = { getAccountInformation: vi.fn(), runMethod: vi.fn() }
  // This test injects the SDK event source; no HTTP indexer is used.
  const { TonIndexerClient } = await import('../../indexer/client')
  const indexer = new TonIndexerClient(() => ({ enabled: false, endpoint: 'https://toncenter.com/api/v3' }))
  const service = new ZkResistorStateService(bridge, indexer, root)
  const store = new FileMerkleStateStore(root, poolAddress)
  const sync = (nextIndex = 0) =>
    service.merkle({
      operation: 'sync',
      poolAddress,
      target: { poolAddress, nextIndex, withdrawalCount: 0, currentRoot: '0' },
    })
  return { root, store, sync }
}

it('preserves a verified snapshot on mismatched heads and allows a fresh sync', async () => {
  const { root, store, sync } = await fixture()
  const checkpoint = await sync()
  const before = await readdir(root)
  await expect(sync(1)).rejects.toBeInstanceOf(ZkResistorSyncIncompleteError)
  expect(await store.hasSnapshot()).toBe(true)
  expect(await readdir(root)).toEqual(before)
  expect(await sync()).toEqual(checkpoint)
})

it('still rebuilds an unreadable snapshot when loading persisted state', async () => {
  const { root, store, sync } = await fixture()
  await store.saveCompact(poolAddress, [Uint8Array.of(1)])
  await expect(sync()).resolves.toMatchObject({ operation: 'sync' })
  expect((await readdir(root)).filter((name) => name.includes('.corrupt-'))).toHaveLength(1)
  expect(await store.hasSnapshot()).toBe(true)
})
