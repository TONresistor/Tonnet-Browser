import type { ProxyStatus, WalletState, WalletTransaction, PaymentNotificationData, StorageBag } from './types'
import type { CocoonState, CocoonLogEvent, WithdrawDriverEvent, RecoveryDriverEvent } from './cocoon-types'

export interface ProxyStatusEvent extends Partial<ProxyStatus> {
  status?: string
  anonymousMode?: boolean
  circuitRelays?: string[]
}

export interface PageNavigateEvent {
  tabId: string
  url: string
  canGoBack: boolean
  canGoForward: boolean
}

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
  'chat:message': [
    msg: {
      room?: string
      nick: string
      text: string
      ts: number
      self?: boolean
      identity: import('./types').ChatIdentityInfo
    },
  ]
  'cocoon:state-changed': [state: CocoonState]
  'cocoon:log': [event: CocoonLogEvent]
  'cocoon:withdraw:event': [event: WithdrawDriverEvent]
  'cocoon:recovery:event': [event: RecoveryDriverEvent]
}

export type IpcEventChannel = keyof IpcEventMap
