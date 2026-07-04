/**
 * Typed contract for main -> renderer push events.
 *
 * Maps each push channel (the IPC_CHANNELS event values, also listed in the
 * preload VALID_EVENT_CHANNELS allowlist) to the TUPLE of arguments emitToRenderer
 * sends and the `on` callback receives. Tuples (not single payloads) because some
 * channels carry multiple positional args (e.g. page:loading -> (loading, tabId)).
 *
 * No main- or renderer-only dependencies: this crosses the process boundary.
 */
import type { ProxyStatus, WalletState, WalletTransaction, PaymentNotificationData, StorageBag } from './types'
import type { CocoonState, CocoonLogEvent, WithdrawDriverEvent, RecoveryDriverEvent } from './cocoon-types'

/**
 * proxy:status is loosely shaped across its emitters (proxy.ts sends a bare
 * ProxyStatus; index.ts adds a `status` discriminator or an error-only object)
 * and StatusBar reads further runtime-augmented fields. Permissive union of
 * every field produced or consumed on this channel.
 */
export interface ProxyStatusEvent extends Partial<ProxyStatus> {
  status?: string
  anonymousMode?: boolean
  circuitRelays?: string[]
}

/** Payload of the page:navigate event. */
export interface PageNavigateEvent {
  tabId: string
  url: string
  canGoBack: boolean
  canGoForward: boolean
}

/** Payload of the settings:changed event (category update or full reset). */
export interface SettingsChangedEvent {
  reset?: boolean
  category?: string
  values?: object
}

export interface IpcEventMap {
  'page:loading': [loading: boolean, tabId: string]
  'page:navigate': [event: PageNavigateEvent]
  'page:title': [title: string, tabId: string]
  'page:favicon': [favicon: string, tabId: string]
  'proxy:status': [status: ProxyStatusEvent]
  'proxy:progress': [progress: { step: number; message: string }]
  'proxy:auto-connect': []
  'storage:bags-updated': [bags: StorageBag[]]
  'storage:status': [status: { running: boolean }]
  'context:open-link': [url: string]
  'settings:changed': [change: SettingsChangedEvent]
  'tab:history-reset': [tabId: string]
  'wallet:balance-updated': [balance: string]
  'wallet:state-changed': [state: WalletState]
  'wallet:new-transaction': [tx: WalletTransaction]
  'wallet:payment-req': [notification: PaymentNotificationData]
  'wallet:payment-made': [notification: PaymentNotificationData]
  'wallet:payment-failed': [notification: PaymentNotificationData]
  'overlay:action': [overlayId: string, actionType: string, actionData: unknown]
  'chat:message': [msg: { nick: string; text: string; ts: number }]
  'cocoon:state-changed': [state: CocoonState]
  'cocoon:log': [event: CocoonLogEvent]
  'cocoon:withdraw:event': [event: WithdrawDriverEvent]
  'cocoon:recovery:event': [event: RecoveryDriverEvent]
}

/** Union of all valid push-event channel names. */
export type IpcEventChannel = keyof IpcEventMap
