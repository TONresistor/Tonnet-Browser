import type { SettingsChangedEvent } from '@shared/ipc-events'
import type { PaymentNotificationData, WalletState, WalletTransaction } from '@shared/types'
import type { WalletSettings } from '@shared/types'

/** Typed main-process boundary owned by the wallet feature. */
export const walletClient = {
  isAvailable: () => typeof window !== 'undefined' && Boolean(window.electron),
  getState: () => window.electron.wallet.getState(),
  create: (password: string) => window.electron.wallet.create(password),
  importWallet: (mnemonic: string[], password: string) => window.electron.wallet.importWallet(mnemonic, password),
  exportMnemonic: (password: string) => window.electron.wallet.exportMnemonic(password),
  deleteWallet: () => window.electron.wallet.deleteWallet(),
  unlock: (password: string) => window.electron.wallet.unlock(password),
  lock: () => window.electron.wallet.lock(),
  setupPassword: (password: string) => window.electron.wallet.setupPassword(password),
  markBackupVerified: () => window.electron.wallet.markBackupVerified(),
  getBalance: () => window.electron.wallet.getBalance(),
  send: (to: string, amount: string, comment?: string) => window.electron.wallet.send(to, amount, comment),
  resolveRecipient: (recipient: string) => window.electron.wallet.resolveRecipient(recipient),
  getHistory: (limit?: number) => window.electron.wallet.getHistory(limit),
  clearHistory: () => window.electron.wallet.clearHistory(),
  approvePayment: (paymentId: string) => window.electron.wallet.approvePayment(paymentId),
  rejectPayment: (paymentId: string) => window.electron.wallet.rejectPayment(paymentId),
  getSettings: () => window.electron.settings.get('wallet'),
  updateSettings: (values: Partial<WalletSettings>) => window.electron.settings.set('wallet', { ...values }),
  onBalanceUpdated: (listener: (balance: string) => void) => window.electron.on('wallet:balance-updated', listener),
  onNewTransaction: (listener: (transaction: WalletTransaction) => void) =>
    window.electron.on('wallet:new-transaction', listener),
  onStateChanged: (listener: (state: WalletState) => void) => window.electron.on('wallet:state-changed', listener),
  onSettingsChanged: (listener: (change: SettingsChangedEvent) => void) =>
    window.electron.on('settings:changed', listener),
  onPaymentRequested: (listener: (notification: PaymentNotificationData) => void) =>
    window.electron.on('wallet:payment-req', listener),
  onPaymentMade: (listener: (notification: PaymentNotificationData) => void) =>
    window.electron.on('wallet:payment-made', listener),
  onPaymentFailed: (listener: (notification: PaymentNotificationData) => void) =>
    window.electron.on('wallet:payment-failed', listener),
}
