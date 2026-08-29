import { SendAndWatchResultSchema, TxConfirmedEventSchema, TxTimeoutEventSchema } from './bridge-codecs'
import type { BridgeEventCallback } from './bridge-event-bus'

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

  async sendAndWatch(boc: Buffer): Promise<string> {
    const encoded = boc.toString('base64')
    const result = SendAndWatchResultSchema.parse(await this.request('lite.sendAndWatch', { boc: encoded }))

    return new Promise<string>((resolve, reject) => {
      let settled = false
      const settle = (outcome: { value: string } | { error: Error }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        disposeConfirmed()
        disposeTimeout()
        this.active.delete(watch)
        void this.events.unsubscribe(result.subscription_id)
        if ('value' in outcome) resolve(outcome.value)
        else reject(outcome.error)
      }
      const onConfirmed: BridgeEventCallback = (data) => {
        const event = TxConfirmedEventSchema.parse(data)
        if (event.msg_hash === result.msg_hash) {
          settle({ value: event.transaction?.hash ?? result.msg_hash })
        }
      }
      const onTimeout: BridgeEventCallback = (data) => {
        const event = TxTimeoutEventSchema.parse(data)
        if (event.msg_hash === result.msg_hash) {
          settle({ error: new Error(`Transaction timed out: ${event.reason ?? 'unknown'}`) })
        }
      }
      const disposeConfirmed = this.events.on('tx_confirmed', onConfirmed)
      const disposeTimeout = this.events.on('tx_timeout', onTimeout)
      const timer = setTimeout(
        () => settle({ error: new Error(`Transaction confirmation timeout (${this.timeoutMs}ms)`) }),
        this.timeoutMs
      )
      const watch: ActiveWatch = { reject: (error) => settle({ error }) }
      this.active.add(watch)
    })
  }

  rejectAll(error: Error): void {
    for (const watch of [...this.active]) watch.reject(error)
  }
}
