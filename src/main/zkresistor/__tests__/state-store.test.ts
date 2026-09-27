import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Address } from '@ton/core'
import type { MerkleStateCheckpoint, MerkleStateEventBatch } from '@tonresistor/zkresistor-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { FileMerkleStateStore } from '../state-store'

const temporaryDirectories: string[] = []
const poolAddress = Address.parseRaw(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true })

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('FileMerkleStateStore', () => {
  it('persists verified batches idempotently and restores bigint fields', async () => {
    const root = await temporaryRoot()
    const store = new FileMerkleStateStore(root, poolAddress)
    const checkpoint = testCheckpoint(12n)
    const batch: MerkleStateEventBatch = { events: [], scannedThrough: checkpoint.position }

    await store.appendVerifiedBatch(poolAddress, batch, checkpoint)
    await store.appendVerifiedBatch(poolAddress, batch, checkpoint)

    const restored = await store.loadVerifiedBatches(poolAddress, {
      blockSeqno: 0,
      transactionLt: 0n,
      eventIndex: 0,
    })
    expect(restored).toHaveLength(1)
    expect(restored[0].checkpoint.position.transactionLt).toBe(12n)
    expect(restored[0].checkpoint.currentRoot).toBe(0n)
  })

  it('atomically replaces the compact snapshot and clears its covered journal', async () => {
    const root = await temporaryRoot()
    const store = new FileMerkleStateStore(root, poolAddress)
    const checkpoint = testCheckpoint(12n)
    await store.appendVerifiedBatch(poolAddress, { events: [], scannedThrough: checkpoint.position }, checkpoint)

    await store.saveCompact(poolAddress, [Uint8Array.of(1, 2), Uint8Array.of(3, 4)])

    const chunks = await store.loadCompact(poolAddress)
    const bytes: number[] = []
    if (chunks) for await (const chunk of chunks) bytes.push(...chunk)
    expect(bytes).toEqual([1, 2, 3, 4])
    expect(await store.journalBytes()).toBe(0)
  })

  it('quarantines persisted state without deleting the recovery copy', async () => {
    const root = await temporaryRoot()
    const store = new FileMerkleStateStore(root, poolAddress)
    await store.saveCompact(poolAddress, [Uint8Array.of(1)])

    const backup = await store.quarantine()

    expect(backup).not.toBeNull()
    expect(await readFile(join(backup!, 'snapshot.bin'))).toEqual(Buffer.from([1]))
    expect((await readdir(root)).some((name) => name.includes('.corrupt-'))).toBe(true)
    expect(await store.hasPersistedState()).toBe(false)
  })
})

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zkresistor-state-'))
  temporaryDirectories.push(directory)
  return directory
}

function testCheckpoint(transactionLt: bigint): MerkleStateCheckpoint {
  return {
    schemaVersion: 1,
    poolAddress,
    position: { blockSeqno: 1, transactionLt, eventIndex: 0 },
    nextIndex: 0,
    withdrawalCount: 0,
    currentRoot: 0n,
    commitmentSeenRoots: Array<bigint>(256).fill(0n),
    nullifierSpentRoots: Array<bigint>(256).fill(0n),
  }
}
