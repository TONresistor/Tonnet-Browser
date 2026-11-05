import type { WalletTransaction } from './schemas'
import type { BridgeAccountState, BridgeTransaction } from './network-types'

export interface WalletSubscriptionBridge {
  subscribeAccountState(address: string, callback: (state: BridgeAccountState) => void): () => void
  subscribeTransactions(address: string, callback: (transaction: BridgeTransaction) => void): () => void
}

export interface WalletSubscriptionCallbacks {
  currentBalance(): string
  accountObserved?(): void
  balanceChanged(balance: string): void
  convertTransaction(transaction: BridgeTransaction): WalletTransaction | null
  transactionReceived(transaction: WalletTransaction): void
  refreshBalance(): Promise<unknown>
  refreshFailed(error: unknown): void
}

/** Owns wallet account subscriptions and their deterministic disposal. */
export class WalletSubscriptionService {
  private disposeAccount: (() => void) | null = null
  private disposeTransactions: (() => void) | null = null
  private generation = 0

  start(bridge: WalletSubscriptionBridge, address: string, callbacks: WalletSubscriptionCallbacks): void {
    this.stop()
    const generation = this.generation
    this.disposeAccount = bridge.subscribeAccountState(address, (state) => {
      if (generation !== this.generation) return
      callbacks.accountObserved?.()
      if (state.balance !== callbacks.currentBalance()) callbacks.balanceChanged(state.balance)
    })
    this.disposeTransactions = bridge.subscribeTransactions(address, (transaction) => {
      if (generation !== this.generation) return
      const formatted = callbacks.convertTransaction(transaction)
      if (!formatted) return
      callbacks.transactionReceived(formatted)
      void callbacks.refreshBalance().catch(callbacks.refreshFailed)
    })
  }

  stop(): void {
    this.generation++
    this.disposeAccount?.()
    this.disposeTransactions?.()
    this.disposeAccount = null
    this.disposeTransactions = null
  }
}
