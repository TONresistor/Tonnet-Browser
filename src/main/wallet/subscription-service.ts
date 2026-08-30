import type { WalletTransaction } from '../../shared/types'
import type { BridgeAccountState, BridgeTransaction } from '../ports/ton-bridge'

export interface WalletSubscriptionBridge {
  subscribeAccountState(address: string, callback: (state: BridgeAccountState) => void): () => void
  subscribeTransactions(address: string, callback: (transaction: BridgeTransaction) => void): () => void
}

export interface WalletSubscriptionCallbacks {
  currentBalance(): string
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

  start(bridge: WalletSubscriptionBridge, address: string, callbacks: WalletSubscriptionCallbacks): void {
    this.stop()
    this.disposeAccount = bridge.subscribeAccountState(address, (state) => {
      if (state.balance !== callbacks.currentBalance()) callbacks.balanceChanged(state.balance)
    })
    this.disposeTransactions = bridge.subscribeTransactions(address, (transaction) => {
      const formatted = callbacks.convertTransaction(transaction)
      if (!formatted) return
      callbacks.transactionReceived(formatted)
      void callbacks.refreshBalance().catch(callbacks.refreshFailed)
    })
  }

  stop(): void {
    this.disposeAccount?.()
    this.disposeTransactions?.()
    this.disposeAccount = null
    this.disposeTransactions = null
  }
}
