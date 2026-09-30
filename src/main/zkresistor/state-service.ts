import path from 'node:path'
import { app } from 'electron'
import { Address } from '@ton/core'
import {
  LocalMerkleStateProvider,
  TonPool,
  createClientEventSource,
  createPoseidon2,
  type AccountState,
  type MerkleStateCheckpoint,
  type MerkleStateSyncTarget,
  type PoseidonInsertPath,
  type PoseidonMembershipPath,
  type SparseSetWitness,
} from '@tonresistor/zkresistor-sdk'
import type { ZkResistorMerkleRequest, ZkResistorMerkleResult } from '../../shared/ipc-contract/zkresistor'
import { createLogger } from '../../shared/logger'
import type { ZkResistorBridgePort } from '../ports/zkresistor-bridge'
import type { TonIndexerClient } from '../indexer/client'
import { ZkResistorChainClient } from './chain-client'
import { ZkResistorCatalogService } from './catalog-service'
import { loadZkResistorResource } from './resources'
import { FileMerkleStateStore } from './state-store'

const log = createLogger('zkresistor:state')
const JOURNAL_COMPACTION_BYTES = 32 * 1024 * 1024

interface PoolSession {
  provider: LocalMerkleStateProvider
  readonly store: FileMerkleStateStore
  readonly queue: SerialQueue
}

export class ZkResistorSyncIncompleteError extends Error {
  constructor(options?: ErrorOptions) {
    super('ZKR synchronization is incomplete. Please try again in a few moments.', options)
    this.name = 'ZkResistorSyncIncompleteError'
  }
}

export class ZkResistorStateService {
  private readonly client: ZkResistorChainClient
  private readonly sessions = new Map<string, Promise<PoolSession>>()
  private catalogPromise: ReturnType<ZkResistorCatalogService['load']> | null = null

  constructor(
    private readonly bridge: ZkResistorBridgePort,
    indexer: TonIndexerClient,
    private readonly stateRoot = path.join(app.getPath('userData'), 'zkresistor', 'state', 'mainnet')
  ) {
    this.client = new ZkResistorChainClient(bridge, indexer)
  }

  async accountState(poolAddress: string): Promise<AccountState> {
    const canonical = await this.assertRegisteredPool(poolAddress)
    return this.client.getAccountState(canonical)
  }

  async merkle(request: ZkResistorMerkleRequest): Promise<ZkResistorMerkleResult> {
    const poolAddress = canonicalAddress(request.poolAddress)
    const session = await this.openSession(poolAddress)
    return session.queue.run(async () => {
      switch (request.operation) {
        case 'sync': {
          const target = fromWireTarget(request.target)
          if (canonicalAddress(target.poolAddress) !== poolAddress) {
            throw new Error('Merkle sync target belongs to another Pool')
          }
          const checkpoint = await this.sync(session, target)
          return { operation: 'sync', checkpoint: wireCheckpoint(checkpoint) }
        }
        case 'checkpoint':
          return { operation: 'checkpoint', checkpoint: wireCheckpoint(await session.provider.checkpoint()) }
        case 'insertionPath':
          return wireInsertionPath(await session.provider.insertionPath(request.nextIndex))
        case 'membershipPath':
          return wireMembershipPath(await session.provider.membershipPath(request.leafIndex))
        case 'sparseSetWitness':
          return wireSparseWitness(await session.provider.sparseSetWitness(request.setId, BigInt(request.key)))
      }
    })
  }

  private async sync(session: PoolSession, target: MerkleStateSyncTarget): Promise<MerkleStateCheckpoint> {
    try {
      const checkpoint = await session.provider.sync(target)
      await this.compactIfNeeded(session)
      return checkpoint
    } catch (error) {
      if (isSyncMismatch(error)) throw new ZkResistorSyncIncompleteError({ cause: error })
      throw error
    }
  }

  private async compactIfNeeded(session: PoolSession): Promise<void> {
    if (!(await session.store.hasSnapshot()) || (await session.store.journalBytes()) >= JOURNAL_COMPACTION_BYTES) {
      await session.provider.saveCompactSnapshot()
    }
  }

  private openSession(poolAddress: string): Promise<PoolSession> {
    let pending = this.sessions.get(poolAddress)
    if (!pending) {
      pending = this.createSession(poolAddress).catch((error) => {
        this.sessions.delete(poolAddress)
        throw error
      })
      this.sessions.set(poolAddress, pending)
    }
    return pending
  }

  private async createSession(poolAddress: string): Promise<PoolSession> {
    await this.assertRegisteredPool(poolAddress)
    const store = new FileMerkleStateStore(this.stateRoot, poolAddress)
    let provider: LocalMerkleStateProvider
    try {
      provider = await this.createProvider(poolAddress, store)
    } catch (error) {
      if (!(await store.hasPersistedState())) throw error
      const backup = await store.quarantine()
      log.warn('Quarantined unreadable local ZKResistor state', { poolAddress, backup })
      provider = await this.createProvider(poolAddress, store)
    }
    return { provider, store, queue: new SerialQueue() }
  }

  private async createProvider(poolAddress: string, store: FileMerkleStateStore): Promise<LocalMerkleStateProvider> {
    const hasher = await loadZkResistorResource('hasher.wasm')
    return LocalMerkleStateProvider.create({
      poolAddress,
      poseidon2: createPoseidon2(new Uint8Array(hasher)),
      source: createClientEventSource(this.client, { pageSize: 100 }),
      chain: TonPool.createStateChainReader(this.client),
      store,
    })
  }

  private async assertRegisteredPool(poolAddress: string): Promise<string> {
    const canonical = canonicalAddress(poolAddress)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const catalog = await this.catalog()
      if (catalog.pools.some((pool) => canonicalAddress(pool.address) === canonical)) return canonical
      this.catalogPromise = null
    }
    throw new Error('Pool is not registered by the pinned Factory')
  }

  private catalog(): ReturnType<ZkResistorCatalogService['load']> {
    this.catalogPromise ??= new ZkResistorCatalogService(this.bridge).load().catch((error) => {
      this.catalogPromise = null
      throw error
    })
    return this.catalogPromise
  }
}

class SerialQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

function wireCheckpoint(checkpoint: MerkleStateCheckpoint) {
  return {
    schemaVersion: 1 as const,
    poolAddress: checkpoint.poolAddress,
    position: {
      blockSeqno: checkpoint.position.blockSeqno,
      transactionLt: checkpoint.position.transactionLt.toString(),
      eventIndex: checkpoint.position.eventIndex,
    },
    nextIndex: checkpoint.nextIndex,
    withdrawalCount: checkpoint.withdrawalCount,
    currentRoot: checkpoint.currentRoot.toString(),
    commitmentSeenRoots: checkpoint.commitmentSeenRoots.map((root) => root.toString()),
    nullifierSpentRoots: checkpoint.nullifierSpentRoots.map((root) => root.toString()),
  }
}

function wireInsertionPath(path: PoseidonInsertPath): ZkResistorMerkleResult {
  return {
    operation: 'insertionPath',
    nextIndex: path.nextIndex,
    currentRoot: path.currentRoot.toString(),
    path: wirePath(path.path),
  }
}

function wireMembershipPath(path: PoseidonMembershipPath): ZkResistorMerkleResult {
  return {
    operation: 'membershipPath',
    leafIndex: path.leafIndex,
    currentRoot: path.currentRoot.toString(),
    path: wirePath(path.path),
  }
}

function wirePath(path: PoseidonInsertPath['path']) {
  return {
    pathElements: path.pathElements.map((element) => element.toString()),
    pathIndices: path.pathIndices.map((index) => {
      if (index !== 0 && index !== 1) throw new Error('Merkle path direction is invalid')
      return index
    }),
  }
}

function wireSparseWitness(witness: SparseSetWitness): ZkResistorMerkleResult {
  return {
    operation: 'sparseSetWitness',
    setId: witness.setId,
    domain: witness.domain,
    key: witness.key.toString(),
    bucketId: witness.bucketId,
    storedRoot: witness.storedRoot.toString(),
    proof: {
      expectedRoot: witness.proof.expectedRoot.toString(),
      siblingBitmap: witness.proof.siblingBitmap.toString(),
      siblings: witness.proof.siblings.map((sibling) => sibling.toString()),
    },
  }
}

function fromWireTarget(
  target: Extract<ZkResistorMerkleRequest, { operation: 'sync' }>['target']
): MerkleStateSyncTarget {
  return {
    poolAddress: canonicalAddress(target.poolAddress),
    nextIndex: target.nextIndex,
    withdrawalCount: target.withdrawalCount,
    currentRoot: BigInt(target.currentRoot),
  }
}

function canonicalAddress(value: string): string {
  return Address.parse(value).toString({ bounceable: true, urlSafe: true })
}

function isSyncMismatch(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return [
    'snapshot replay cursor is ahead',
    'replayed state does not reach',
    'checkpoint does not match on-chain getters',
  ].some((message) => error.message.includes(message))
}
