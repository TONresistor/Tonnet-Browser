import type { TonConnectSenderPort } from './request-context'
import type { DisconnectEvent } from './types'

export interface TonConnectEventDeliveryPort {
  track(domain: string, sender: TonConnectSenderPort): void
  emitDisconnect(domain: string, event: DisconnectEvent): void
}
