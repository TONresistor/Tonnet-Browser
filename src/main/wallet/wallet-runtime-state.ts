import type { WalletSubscriptionBridge, WalletSubscriptionCallbacks } from './subscription-service'
import { WalletSubscriptionService } from './subscription-service'
import { SeqnoLeaseManager } from './seqno-lease'

export class WalletRuntimeState {
  private currentBalance = '0'
  private localSeqno = 0
  private readonly seqnoLeases = new SeqnoLeaseManager()
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
    this.seqnoLeases.resetMemory()
  }

  startSubscription(bridge: WalletSubscriptionBridge, address: string, callbacks: WalletSubscriptionCallbacks): void {
    this.subscriptions.start(bridge, address, callbacks)
  }

  stopSubscription(): void {
    this.subscriptions.stop()
  }

  async observeSeqno(addressRaw: string, onChainSeqno: number): Promise<number | null> {
    this.localSeqno = onChainSeqno
    return (await this.seqnoLeases.observe(addressRaw, onChainSeqno))?.validUntil ?? null
  }

  async syncSeqno(addressRaw: string, getOnChainSeqno: () => Promise<number>, waitForPending: boolean): Promise<void> {
    while (true) {
      const pendingUntil = await this.observeSeqno(addressRaw, await getOnChainSeqno())
      if (pendingUntil === null || !waitForPending) return
      const remainingMs = pendingUntil * 1_000 - Date.now()
      if (remainingMs <= 0) continue
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, remainingMs)))
    }
  }

  async acquireSeqno(addressRaw: string, validUntil: number): Promise<number> {
    const seqno = await this.seqnoLeases.acquire(addressRaw, this.localSeqno, validUntil)
    this.localSeqno = seqno + 1
    return seqno
  }

  releaseSeqno(addressRaw: string, seqno: number): Promise<void> {
    return this.seqnoLeases.release(addressRaw, seqno)
  }
}
