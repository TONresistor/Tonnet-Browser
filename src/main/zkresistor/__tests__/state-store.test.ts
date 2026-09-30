import { promises as fs } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Address } from '@ton/core'
import type { MerkleStateCheckpoint, MerkleStateEventBatch } from '@tonresistor/zkresistor-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileMerkleStateStore } from '../state-store'

const temporaryDirectories: string[] = []
const poolAddress = Address.parseRaw(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true })

afterEach(async () => {
  vi.restoreAllMocks()
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

  it('writes complete snapshots even when a low-level write would be partial', async () => {
    const store = new FileMerkleStateStore(await temporaryRoot(), poolAddress)
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      const write = handle.write.bind(handle)
      const binaryHandle = handle as {
        write(buffer: Uint8Array): Promise<{ bytesWritten: number; buffer: Uint8Array }>
      }
      vi.spyOn(binaryHandle, 'write').mockImplementation((buffer) => write(buffer.subarray(0, 1)))
      return handle
    })
    await store.saveCompact(poolAddress, [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6)])
    const chunks = await store.loadCompact(poolAddress)
    const bytes: number[] = []
    if (chunks) for await (const chunk of chunks) bytes.push(...chunk)
    expect(bytes).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps the previous snapshot and journal if a replacement write fails', async () => {
    const root = await temporaryRoot()
    const store = new FileMerkleStateStore(root, poolAddress)
    await store.saveCompact(poolAddress, [Uint8Array.of(7, 8)])
    const checkpoint = testCheckpoint(12n)
    await store.appendVerifiedBatch(poolAddress, { events: [], scannedThrough: checkpoint.position }, checkpoint)
    const journalSize = await store.journalBytes()
    const open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args)
      vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
        await handle.write(Uint8Array.of(1))
        throw new Error('Disk full')
      })
      return handle
    })
    await expect(store.saveCompact(poolAddress, [Uint8Array.of(1, 2, 3)])).rejects.toThrow('Disk full')
    const chunks = await store.loadCompact(poolAddress)
    const bytes: number[] = []
    if (chunks) for await (const chunk of chunks) bytes.push(...chunk)
    expect(bytes).toEqual([7, 8])
    expect(await store.journalBytes()).toBe(journalSize)
    const directory = join(root, Address.parse(poolAddress).toRawString().replace(':', '-'))
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false)
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
