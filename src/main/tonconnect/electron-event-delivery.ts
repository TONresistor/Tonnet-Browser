import { tonConnectEventContract } from '../../shared/ipc-contract/tonconnect'
import type { TonConnectEventDeliveryPort } from './event-delivery'
import type { TonConnectSenderPort } from './request-context'
import type { DisconnectEvent } from './types'

/** Electron edge adapter translating TonConnect application events to IPC. */
export class ElectronTonConnectEventDelivery implements TonConnectEventDeliveryPort {
  private readonly sendersByDomain = new Map<string, Set<TonConnectSenderPort>>()

  track(domain: string, sender: TonConnectSenderPort): void {
    let senders = this.sendersByDomain.get(domain)
    if (!senders) {
      senders = new Set()
      this.sendersByDomain.set(domain, senders)
    }
    if (senders.has(sender)) return

    senders.add(sender)
    sender.once('destroyed', () => {
      const current = this.sendersByDomain.get(domain)
      if (!current) return
      current.delete(sender)
      if (current.size === 0) this.sendersByDomain.delete(domain)
    })
  }

  emitDisconnect(domain: string, event: DisconnectEvent): void {
    const senders = this.sendersByDomain.get(domain)
    if (!senders) return
    const [validated] = tonConnectEventContract.payload.parse([event])
    for (const sender of senders) {
      if (!sender.isDestroyed()) sender.send(tonConnectEventContract.channel, validated)
    }
  }
}
