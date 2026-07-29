import type { SettingsChangedEvent } from '@shared/ipc-events'
import type { MessengerSettings } from '@shared/types'

export const messengerClient = {
  getSettings: () => window.electron.settings.get('messenger'),
  updateSettings: (values: Partial<MessengerSettings>) => window.electron.settings.set('messenger', { ...values }),
  connect: (room?: string, node?: string) => window.electron.chat.connect(room, node),
  disconnect: () => window.electron.chat.disconnect(),
  send: (text: string) => window.electron.chat.send(text),
  sendDirectMessage: (peerKey: string, text: string) => window.electron.chat.dmSend(peerKey, text),
  getIdentity: () => window.electron.chat.identity(),
  linkIdentity: () => window.electron.chat.linkIdentity(),
  detectDomains: () => window.electron.chat.detectDomains(),
  claimDomain: (domain: string) => window.electron.chat.claimDomain(domain),
  clearDomain: () => window.electron.chat.clearDomain(),
  resetIdentity: () => window.electron.chat.resetIdentity(),
  onSettingsChanged: (listener: (change: SettingsChangedEvent) => void) =>
    window.electron.on('settings:changed', listener),
  onMessage: (listener: Parameters<typeof window.electron.on<'chat:message'>>[1]) =>
    window.electron.on('chat:message', listener),
  onDirectMessage: (listener: Parameters<typeof window.electron.on<'chat:dm'>>[1]) =>
    window.electron.on('chat:dm', listener),
  onConnection: (listener: Parameters<typeof window.electron.on<'chat:connection'>>[1]) =>
    window.electron.on('chat:connection', listener),
}
