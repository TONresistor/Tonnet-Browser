import { Address } from '@ton/core'
import type {
  AccountState,
  Client,
  GetTransactionsResult,
  MerklePath,
  MerkleStateCheckpoint,
  MerkleStateProvider,
  MerkleStateSyncTarget,
  RunMethodArg,
  RunMethodResult,
  SparseSetId,
  SparseSetWitness,
  TransactionCursor,
} from '@tonresistor/zkresistor-sdk'
import type { ZkResistorMerkleResult } from '@shared/types'
import { zkResistorClient } from '../client'

export interface TonPoolSession {
  client: Client
  stateProvider: MerkleStateProvider
}

export class TonPoolSessionFactory {
  private readonly sessions = new Map<string, TonPoolSession>()

  open(poolAddress: string): TonPoolSession {
    const canonical = canonicalAddress(poolAddress)
    let session = this.sessions.get(canonical)
    if (!session) {
      session = {
        client: new IpcTonPoolClient(canonical),
        stateProvider: new IpcMerkleStateProvider(canonical),
      }
      this.sessions.set(canonical, session)
    }
    return session
  }
}

class IpcTonPoolClient implements Client {
  constructor(private readonly poolAddress: string) {}

  async getAccountState(address: string): Promise<AccountState> {
    this.assertPool(address)
    return zkResistorClient.account(this.poolAddress)
  }

  runMethod(address: string, _method: string, _params: readonly RunMethodArg[]): Promise<RunMethodResult> {
    this.assertPool(address)
    return Promise.reject(new Error('This ZKResistor flow does not expose arbitrary Pool getters'))
  }

  getTransactions(
    address: string,
    _limit: number,
    _before: TransactionCursor | undefined
  ): Promise<GetTransactionsResult> {
    this.assertPool(address)
    return Promise.reject(new Error('Transaction replay is isolated in the main process'))
  }

  private assertPool(address: string): void {
    if (canonicalAddress(address) !== this.poolAddress) throw new Error('Pool client rejected another address')
  }
}

class IpcMerkleStateProvider implements MerkleStateProvider {
  readonly privacyMode = 'local' as const

  constructor(private readonly poolAddress: string) {}

  async sync(target: MerkleStateSyncTarget): Promise<MerkleStateCheckpoint> {
    this.assertPool(target.poolAddress)
    const result = await zkResistorClient.merkle({
      operation: 'sync',
      poolAddress: this.poolAddress,
      target: {
        poolAddress: this.poolAddress,
        nextIndex: target.nextIndex,
        withdrawalCount: target.withdrawalCount,
        currentRoot: target.currentRoot.toString(),
      },
    })
    if (result.operation !== 'sync') throw new Error('Unexpected Merkle sync response')
    return fromWireCheckpoint(result.checkpoint)
  }

  async checkpoint(): Promise<MerkleStateCheckpoint> {
    const result = await zkResistorClient.merkle({ operation: 'checkpoint', poolAddress: this.poolAddress })
    if (result.operation !== 'checkpoint') throw new Error('Unexpected Merkle checkpoint response')
    return fromWireCheckpoint(result.checkpoint)
  }

  async insertionPath(nextIndex: number) {
    const result = await zkResistorClient.merkle({
      operation: 'insertionPath',
      poolAddress: this.poolAddress,
      nextIndex,
    })
    if (result.operation !== 'insertionPath') throw new Error('Unexpected Merkle insertion response')
    return {
      nextIndex: result.nextIndex,
      currentRoot: BigInt(result.currentRoot),
      path: fromWirePath(result.path),
    }
  }

  async membershipPath(leafIndex: number) {
    const result = await zkResistorClient.merkle({
      operation: 'membershipPath',
      poolAddress: this.poolAddress,
      leafIndex,
    })
    if (result.operation !== 'membershipPath') throw new Error('Unexpected Merkle membership response')
    return {
      leafIndex: result.leafIndex,
      currentRoot: BigInt(result.currentRoot),
      path: fromWirePath(result.path),
    }
  }

  async sparseSetWitness(setId: SparseSetId, key: bigint): Promise<SparseSetWitness> {
    const result = await zkResistorClient.merkle({
      operation: 'sparseSetWitness',
      poolAddress: this.poolAddress,
      setId,
      key: key.toString(),
    })
    if (result.operation !== 'sparseSetWitness') throw new Error('Unexpected sparse witness response')
    return {
      setId: result.setId,
      domain: result.domain,
      key: BigInt(result.key),
      bucketId: result.bucketId,
      storedRoot: BigInt(result.storedRoot),
      proof: {
        expectedRoot: BigInt(result.proof.expectedRoot),
        siblingBitmap: BigInt(result.proof.siblingBitmap),
        siblings: result.proof.siblings.map(BigInt),
      },
    }
  }

  private assertPool(address: string): void {
    if (canonicalAddress(address) !== this.poolAddress) throw new Error('Merkle target belongs to another Pool')
  }
}

function fromWireCheckpoint(
  checkpoint: Extract<ZkResistorMerkleResult, { operation: 'sync' }>['checkpoint']
): MerkleStateCheckpoint {
  return {
    schemaVersion: 1,
    poolAddress: canonicalAddress(checkpoint.poolAddress),
    position: {
      blockSeqno: checkpoint.position.blockSeqno,
      transactionLt: BigInt(checkpoint.position.transactionLt),
      eventIndex: checkpoint.position.eventIndex,
    },
    nextIndex: checkpoint.nextIndex,
    withdrawalCount: checkpoint.withdrawalCount,
    currentRoot: BigInt(checkpoint.currentRoot),
    commitmentSeenRoots: checkpoint.commitmentSeenRoots.map(BigInt),
    nullifierSpentRoots: checkpoint.nullifierSpentRoots.map(BigInt),
  }
}

function fromWirePath(path: { pathElements: string[]; pathIndices: (0 | 1)[] }): MerklePath {
  return {
    pathElements: path.pathElements.map(BigInt),
    pathIndices: [...path.pathIndices],
  }
}

function canonicalAddress(value: string): string {
  return Address.parse(value).toString({ bounceable: true, urlSafe: true })
}
