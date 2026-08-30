import type { DnsResolveResult } from '../../shared/types'
import type {
  AccountInformationResult,
  BridgeAccountState,
  BridgeTransaction,
  EmulateTransactionResult,
} from '../ports/ton-bridge'

export interface WalletBridgePort {
  getBalance(address: string): Promise<string>
  getAccountInformation(address: string): Promise<AccountInformationResult>
  emulateTransaction(address: string, boc: string): Promise<EmulateTransactionResult>
  getSeqno(address: string): Promise<number>
  getTransactions(address: string, limit?: number, lastLt?: string, lastHash?: string): Promise<BridgeTransaction[]>
  sendAndWatch(boc: Buffer): Promise<string>
  broadcast(boc: Buffer): Promise<void>
  resolveDomain(domain: string): Promise<DnsResolveResult>
  runMethod(address: string, method: string, params?: unknown[]): Promise<unknown>
  subscribeAccountState(address: string, callback: (state: BridgeAccountState) => void): () => void
  subscribeTransactions(address: string, callback: (transaction: BridgeTransaction) => void): () => void
}
