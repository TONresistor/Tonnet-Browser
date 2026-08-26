import type { SettingsChangedEvent } from '@shared/ipc-events'
import type { PaymentNotificationData, WalletState, WalletTransaction } from '@shared/types'
import type { WalletSettings } from '@shared/types'

/** Typed main-process boundary owned by the wallet feature. */
export const walletClient = {
  isAvailable: () => typeof window !== 'undefined' && Boolean(window.electron),
  getState: () => window.electron.wallet.getState(),
  create: (options: { password?: string }) => window.electron.wallet.create(options),
  discoverAccounts: (mnemonic: string[]) => window.electron.wallet.discoverAccounts(mnemonic),
  importWallet: (mnemonic: string[], password: string, walletVersion: 'v3R1' | 'v3R2' | 'v4R2' | 'v5R1') =>
    window.electron.wallet.importWallet(mnemonic, password, walletVersion),
  exportMnemonic: (password?: string) => window.electron.wallet.exportMnemonic(password),
  deleteWallet: (password: string) => window.electron.wallet.deleteWallet(password),
  forgetWallet: () => window.electron.wallet.forgetWallet(),
  unlock: (password: string) => window.electron.wallet.unlock(password),
  lock: () => window.electron.wallet.lock(),
  setupPassword: (password: string) => window.electron.wallet.setupPassword(password),
  createBackupChallenge: (password?: string) => window.electron.wallet.createBackupChallenge(password),
  markBackupVerified: (challengeId: string, password: string | undefined, answers: string[]) =>
    window.electron.wallet.markBackupVerified(challengeId, password, answers),
  changePassword: (currentPassword: string, nextPassword: string) =>
    window.electron.wallet.changePassword(currentPassword, nextPassword),
  setSensitiveDisplay: (active: boolean) => window.electron.wallet.setSensitiveDisplay(active),
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
