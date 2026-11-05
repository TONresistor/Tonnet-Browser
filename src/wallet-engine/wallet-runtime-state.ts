import type { WalletSubscriptionBridge, WalletSubscriptionCallbacks } from './subscription-service'
import { WalletSubscriptionService } from './subscription-service'

export class WalletRuntimeState {
  private currentBalance = '0'
  private localSeqno = 0
  private readonly subscriptions = new WalletSubscriptionService()

  get balance(): string {
    return this.currentBalance
  }

  get seqno(): number {
    return this.localSeqno
  }

  setBalance(balance: string): boolean {
    if (balance === this.currentBalance) return false
    this.currentBalance = balance
    return true
  }

  resetAccount(): void {
    this.subscriptions.stop()
    this.currentBalance = '0'
    this.localSeqno = 0
  }

  startSubscription(bridge: WalletSubscriptionBridge, address: string, callbacks: WalletSubscriptionCallbacks): void {
    this.subscriptions.start(bridge, address, callbacks)
  }

  stopSubscription(): void {
    this.subscriptions.stop()
  }
}
