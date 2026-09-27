import { Address } from '@ton/core'
import type {
  AccountState,
  Client,
  GetTransactionsResult,
  RunMethodArg,
  RunMethodResult,
  TransactionCursor,
} from '@tonresistor/zkresistor-sdk'
import { TonIndexerDisabledError, type TonIndexerClient } from '../indexer/client'
import type { ZkResistorBridgePort } from '../ports/zkresistor-bridge'
import { fetchReplayTransactionsViaIndexer } from './indexer-history'

export class ZkResistorChainClient implements Client {
  constructor(
    private readonly bridge: ZkResistorBridgePort,
    private readonly indexer?: TonIndexerClient
  ) {}

  async getAccountState(address: string): Promise<AccountState> {
    const canonical = Address.parse(address).toString({ bounceable: true, urlSafe: true })
    const { status, balance, code, data } = await this.bridge.getAccountInformation(canonical)
    return {
      status,
      balance,
      ...(code ? { code } : {}),
      ...(data ? { data } : {}),
    }
  }

  async runMethod(address: string, method: string, params: readonly RunMethodArg[]): Promise<RunMethodResult> {
    const canonical = Address.parse(address).toString({ bounceable: true, urlSafe: true })
    const result = await this.bridge.runMethod(canonical, method, [...params])
    if (!result || typeof result !== 'object') throw new Error(`${method} returned an invalid result`)
    const { exit_code, stack } = result as { exit_code?: unknown; stack?: unknown }
    if (typeof exit_code !== 'number' || !Array.isArray(stack)) {
      throw new Error(`${method} returned an invalid result`)
    }
    if (!stack.every((entry) => entry === null || typeof entry === 'string')) {
      throw new Error(`${method} returned an unsupported stack`)
    }
    return { exit_code, stack }
  }

  async getTransactions(
    address: string,
    limit: number,
    before: TransactionCursor | undefined
  ): Promise<GetTransactionsResult> {
    const canonical = Address.parse(address).toString({ bounceable: true, urlSafe: true })
    // The pinned Bridge v0.5.1 does not provide the fields required for deterministic replay.
    // History comes explicitly from the user-enabled indexer; contract state still uses the Bridge.
    if (!this.indexer?.isEnabled()) throw new TonIndexerDisabledError()
    return fetchReplayTransactionsViaIndexer(this.indexer, canonical, limit, before)
  }
}
