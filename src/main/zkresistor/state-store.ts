import { randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Address } from '@ton/core'
import {
  validateMerkleStateCheckpoint,
  type CompactSnapshotChunks,
  type IndexedPoolEvent,
  type MerkleStateCheckpoint,
  type MerkleStateEventBatch,
  type MerkleStateSnapshotStore,
  type PersistedMerkleStateBatch,
  type ReplayPosition,
} from '@tonresistor/zkresistor-sdk'
import { writeSecureFileAtomic } from '../utils/secure-fs'

const JOURNAL_SCHEMA_VERSION = 1

export class FileMerkleStateStore implements MerkleStateSnapshotStore {
  private readonly poolAddress: string
  private readonly poolDirectory: string
  private readonly snapshotPath: string
  private readonly journalDirectory: string

  constructor(rootDirectory: string, poolAddress: string) {
    const address = Address.parse(poolAddress)
    this.poolAddress = address.toString({ bounceable: true, urlSafe: true })
    this.poolDirectory = path.join(rootDirectory, address.toRawString().replace(':', '-'))
    this.snapshotPath = path.join(this.poolDirectory, 'snapshot.bin')
    this.journalDirectory = path.join(this.poolDirectory, 'journal')
  }

  async loadCompact(poolAddress: string): Promise<CompactSnapshotChunks | null> {
    this.assertPool(poolAddress)
    try {
      await fs.access(this.snapshotPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    return this.readSnapshot()
  }

  async saveCompact(poolAddress: string, chunks: Iterable<Uint8Array>): Promise<void> {
    this.assertPool(poolAddress)
    await fs.mkdir(this.poolDirectory, { recursive: true, mode: 0o700 })
    const temporaryPath = path.join(this.poolDirectory, `.snapshot-${randomUUID()}.tmp`)
    const handle = await fs.open(temporaryPath, 'wx', 0o600)
    try {
      for (const chunk of chunks) await handle.writeFile(chunk)
      await handle.sync()
      await handle.close()
      await fs.rename(temporaryPath, this.snapshotPath)
      if (process.platform !== 'win32') await fs.chmod(this.snapshotPath, 0o600)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await fs.unlink(temporaryPath).catch(() => undefined)
      throw error
    }
    await this.clearJournal()
  }

  async appendVerifiedBatch(
    poolAddress: string,
    batch: MerkleStateEventBatch,
    checkpoint: MerkleStateCheckpoint
  ): Promise<void> {
    this.assertPool(poolAddress)
    validateMerkleStateCheckpoint(checkpoint)
    if (checkpoint.poolAddress !== this.poolAddress) throw new Error('Merkle journal belongs to another Pool')
    const encoded = encodeBatch({ batch, checkpoint })
    const filePath = path.join(this.journalDirectory, `${positionKey(checkpoint.position)}.json`)
    try {
      const existing = await fs.readFile(filePath, 'utf8')
      if (existing === encoded) return
      throw new Error('Merkle journal checkpoint conflicts with an existing batch')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await writeSecureFileAtomic(filePath, encoded, 'utf8')
  }

  async loadVerifiedBatches(poolAddress: string, after: ReplayPosition): Promise<PersistedMerkleStateBatch[]> {
    this.assertPool(poolAddress)
    let names: string[]
    try {
      names = await fs.readdir(this.journalDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => decodeBatch(await fs.readFile(path.join(this.journalDirectory, name), 'utf8')))
    )
    if (entries.some(({ checkpoint }) => checkpoint.poolAddress !== this.poolAddress)) {
      throw new Error('Merkle journal belongs to another Pool')
    }
    const pending = entries
      .filter(({ checkpoint }) => comparePosition(checkpoint.position, after) > 0)
      .sort((left, right) => comparePosition(left.checkpoint.position, right.checkpoint.position))
    for (let index = 1; index < pending.length; index += 1) {
      if (comparePosition(pending[index - 1].checkpoint.position, pending[index].checkpoint.position) >= 0) {
        throw new Error('Merkle journal positions are not strictly increasing')
      }
    }
    return pending
  }

  async hasSnapshot(): Promise<boolean> {
    try {
      await fs.access(this.snapshotPath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async hasPersistedState(): Promise<boolean> {
    if (await this.hasSnapshot()) return true
    try {
      return (await fs.readdir(this.journalDirectory)).some((name) => name.endsWith('.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  async journalBytes(): Promise<number> {
    let names: string[]
    try {
      names = await fs.readdir(this.journalDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    const sizes = await Promise.all(
      names.filter((name) => name.endsWith('.json')).map((name) => fs.stat(path.join(this.journalDirectory, name)))
    )
    return sizes.reduce((total, item) => total + item.size, 0)
  }

  async quarantine(): Promise<string | null> {
    const backupPath = `${this.poolDirectory}.corrupt-${Date.now()}-${randomUUID()}`
    try {
      await fs.rename(this.poolDirectory, backupPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return null
    }
    return backupPath
  }

  private async *readSnapshot(): AsyncGenerator<Uint8Array> {
    for await (const chunk of createReadStream(this.snapshotPath, { highWaterMark: 1024 * 1024 })) {
      yield chunk as Buffer
    }
  }

  private async clearJournal(): Promise<void> {
    let names: string[]
    try {
      names = await fs.readdir(this.journalDirectory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    await Promise.all(
      names.filter((name) => name.endsWith('.json')).map((name) => fs.unlink(path.join(this.journalDirectory, name)))
    )
  }

  private assertPool(poolAddress: string): void {
    const canonical = Address.parse(poolAddress).toString({ bounceable: true, urlSafe: true })
    if (canonical !== this.poolAddress) throw new Error('Merkle state store rejected another Pool')
  }
}

function encodeBatch(entry: PersistedMerkleStateBatch): string {
  return JSON.stringify({ schemaVersion: JOURNAL_SCHEMA_VERSION, ...entry }, (_key, value: unknown) =>
    typeof value === 'bigint' ? { zkResistorBigInt: value.toString() } : value
  )
}

function decodeBatch(raw: string): PersistedMerkleStateBatch {
  const value = JSON.parse(raw, (_key, item: unknown) => {
    if (
      isRecord(item) &&
      Object.keys(item).length === 1 &&
      typeof item.zkResistorBigInt === 'string' &&
      /^(?:0|[1-9]\d*)$/.test(item.zkResistorBigInt)
    ) {
      return BigInt(item.zkResistorBigInt)
    }
    return item
  }) as unknown
  if (!isRecord(value) || value.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
    throw new Error('Merkle journal schema is invalid')
  }
  const entry = value as unknown as PersistedMerkleStateBatch
  validateMerkleStateCheckpoint(entry.checkpoint)
  assertBatch(entry.batch)
  return entry
}

function assertBatch(batch: MerkleStateEventBatch): void {
  if (!isRecord(batch) || !Array.isArray(batch.events)) throw new Error('Merkle journal batch is invalid')
  assertPosition(batch.scannedThrough)
  for (const indexed of batch.events) assertIndexedEvent(indexed)
}

function assertIndexedEvent(indexed: IndexedPoolEvent): void {
  if (!isRecord(indexed) || !isRecord(indexed.event)) throw new Error('Merkle journal event is invalid')
  assertPosition(indexed.position)
  const event = indexed.event
  assertSparseUpdate(event.sparseUpdate)
  if (event.kind === 'deposit') {
    assertSafeInteger(event.leafIndex)
    assertBigInt(event.commitment)
    assertBigInt(event.newRoot)
    Address.parse(event.fromUser)
    return
  }
  if (event.kind === 'ton-withdraw') {
    assertBigInt(event.nullifierHash)
    assertBigInt(event.payout)
    Address.parse(event.recipient)
    return
  }
  if (event.kind === 'jetton-withdraw') {
    assertBigInt(event.clientQueryId)
    assertBigInt(event.nullifierHash)
    assertBigInt(event.payout)
    Address.parse(event.recipient)
    return
  }
  throw new Error('Merkle journal event kind is invalid')
}

function assertSparseUpdate(value: unknown): void {
  if (!isRecord(value)) throw new Error('Merkle journal sparse update is invalid')
  assertSafeInteger(value.bucketId, 255)
  assertBigInt(value.newRoot)
}

function assertPosition(value: unknown): asserts value is ReplayPosition {
  if (!isRecord(value)) throw new Error('Merkle journal position is invalid')
  assertSafeInteger(value.blockSeqno)
  assertBigInt(value.transactionLt)
  assertSafeInteger(value.eventIndex)
}

function assertSafeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error('Merkle journal integer is invalid')
  }
}

function assertBigInt(value: unknown): asserts value is bigint {
  if (typeof value !== 'bigint' || value < 0n) throw new Error('Merkle journal integer is invalid')
}

function positionKey(position: ReplayPosition): string {
  return `${position.transactionLt}-${position.eventIndex}-${position.blockSeqno}`
}

function comparePosition(left: ReplayPosition, right: ReplayPosition): number {
  if (left.transactionLt !== right.transactionLt) return left.transactionLt < right.transactionLt ? -1 : 1
  if (left.eventIndex !== right.eventIndex) return left.eventIndex - right.eventIndex
  return left.blockSeqno - right.blockSeqno
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
