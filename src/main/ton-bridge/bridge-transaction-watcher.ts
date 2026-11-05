import {
  SendAndWatchResultSchema,
  TxConfirmedEventSchema,
  TxTimeoutEventSchema,
  WalletConfirmationReceiptSchema,
} from './bridge-codecs'
import type { BridgeEventCallback } from './bridge-event-bus'
import { createLogger } from '../../shared/logger'
import { Cell } from '@ton/core'
import type { WalletConfirmationReceipt } from '../../wallet-engine'

const log = createLogger('ton-bridge:watch')

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>

export interface BridgeWatchEventsPort {
  on(event: string, callback: BridgeEventCallback): () => void
  unsubscribe(subscriptionId: string): Promise<void>
}

interface ActiveWatch {
  reject(error: Error): void
}

/** Owns confirmation watches and guarantees every watch settles exactly once. */
export class BridgeTransactionWatcher {
  private readonly active = new Set<ActiveWatch>()

  constructor(
    private readonly request: Request,
    private readonly events: BridgeWatchEventsPort,
    private readonly timeoutMs = 120_000
  ) {}

  async sendAndWatch(
    boc: Buffer,
    onSubmitted?: (messageHash: string) => Promise<void>
  ): Promise<string | WalletConfirmationReceipt> {
    const started = performance.now()
    const cells = Cell.fromBoc(boc)
    if (cells.length !== 1) throw new Error('Expected one signed external message')
    const expectedHash = cells[0].hash().toString('hex')
    let acknowledgedAt: number | undefined
    let subscriptionId: string | undefined
    let unsubscribed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    let disposeConfirmed = () => {}
    let disposeTimeout = () => {}
    const unsubscribe = () => {
      if (subscriptionId && !unsubscribed) {
        unsubscribed = true
        void this.events.unsubscribe(subscriptionId)
      }
    }
    let rejectWatch!: (error: Error) => void
    let watch!: ActiveWatch
    const confirmation = new Promise<string | WalletConfirmationReceipt>((resolve, reject) => {
      const settle = (outcome: { value: string | WalletConfirmationReceipt } | { error: Error }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        disposeConfirmed()
        disposeTimeout()
        this.active.delete(watch)
        unsubscribe()
        if ('value' in outcome) resolve(outcome.value)
        else reject(outcome.error)
      }
      watch = { reject: (error) => settle({ error }) }
      rejectWatch = watch.reject
      disposeConfirmed = this.events.on('tx_confirmed', (data) => {
        const event = TxConfirmedEventSchema.parse(data)
        if (event.msg_hash === expectedHash) {
          const receipt = WalletConfirmationReceiptSchema.safeParse(event.receipt)
          settle({ value: receipt.success ? receipt.data : (event.transaction?.hash ?? expectedHash) })
        }
      })
      disposeTimeout = this.events.on('tx_timeout', (data) => {
        const event = TxTimeoutEventSchema.parse(data)
        if (event.msg_hash === expectedHash)
          settle({ error: new Error(`Transaction timed out: ${event.reason ?? 'unknown'}`) })
      })
      this.active.add(watch)
    })
    // Observe early events while the RPC acknowledgement or its durable write is pending.
    void confirmation.catch(() => undefined)
    try {
      const result = SendAndWatchResultSchema.parse(
        await this.request('lite.sendAndWatch', {
          boc: boc.toString('base64'),
          include_receipt: true,
        })
      )
      subscriptionId = result.subscription_id
      if (settled) unsubscribe()
      if (result.msg_hash !== expectedHash)
        throw new Error('Broadcast acknowledgement does not match the signed message')
      acknowledgedAt = performance.now()
      if (!settled)
        timer = setTimeout(
          () => rejectWatch(new Error(`Transaction confirmation timeout (${this.timeoutMs}ms)`)),
          this.timeoutMs
        )
      await onSubmitted?.(result.msg_hash)
      return await confirmation
    } catch (error) {
      rejectWatch(error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      // Keep logging after listener setup/settlement and in the caller's request context.
      const finished = performance.now()
      try {
        log.event('info', 'wallet.transfer.timing', 'Wallet transfer timing', {
          phase: 'broadcast',
          durationMs: Math.round((acknowledgedAt ?? finished) - started),
        })
        if (acknowledgedAt !== undefined)
          log.event('info', 'wallet.transfer.timing', 'Wallet transfer timing', {
            phase: 'confirmation',
            durationMs: Math.round(finished - acknowledgedAt),
          })
      } catch {
        /* diagnostics only */
      }
    }
  }

  rejectAll(error: Error): void {
    for (const watch of [...this.active]) watch.reject(error)
  }
}
