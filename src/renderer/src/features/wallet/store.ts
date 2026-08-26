/**
 * Wallet store.
 * Non-persisted runtime wallet state — synced from main via IPC.
 */

import { errorMessage } from '@shared/errors'
import { create } from 'zustand'
import type { WalletTransaction, PaymentNotificationData, NotificationStyle } from '@shared/types'
import { WALLET_TX_DISPLAY_CAP } from '@shared/constants'
import { walletClient } from '@/features/wallet/client'
import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'

interface WalletStore {
  isCreated: boolean
  address: string
  addressRaw: string
  publicKey: string
  balance: string
  transactions: WalletTransaction[]
  isLoading: boolean
  isSending: boolean
  error: string | null
  decryptFailed: boolean
  weakEncryption: boolean
  isLocked: boolean
  needsPasswordSetup: boolean
  passwordProtected: boolean
  backupVerified: boolean
  notificationStyle: NotificationStyle
  pending402Notification: PaymentNotificationData | null
  setPending402Notification: (data: PaymentNotificationData | null) => void
  approvePending402: () => Promise<void>
  rejectPending402: () => Promise<void>
  init: () => Promise<void>
  create: (options: { password?: string }) => Promise<string[] | null>
  discoverAccounts: (mnemonic: string[]) => Promise<WalletAccountCandidate[]>
  importWallet: (
    mnemonic: string[],
    password: string,
    walletVersion: WalletAccountCandidate['version']
  ) => Promise<void>
  exportMnemonic: (password?: string) => Promise<string[]>
  unlock: (password: string) => Promise<void>
  lock: () => Promise<void>
  setupPassword: (password: string) => Promise<void>
  createBackupChallenge: (password?: string) => Promise<{ challengeId: string; indexes: number[] }>
  markBackupVerified: (challengeId: string, password: string | undefined, answers: string[]) => Promise<void>
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  refreshBalance: () => Promise<void>
  send: (to: string, amount: string, comment?: string, encryptedComment?: boolean) => Promise<void>
  loadHistory: (limit?: number) => Promise<void>
  clearHistory: () => Promise<void>
  deleteWallet: (password: string) => Promise<void>
  forgetWallet: () => Promise<void>
  setError: (error: string | null) => void
}

export const useWalletStore = create<WalletStore>((set, get) => {
  // IPC event listeners — stored for cleanup
  let unsubBalance: (() => void) | null = null
  let unsubState: (() => void) | null = null
  let unsubNewTx: (() => void) | null = null

  const setupListeners = () => {
    if (unsubBalance) unsubBalance()
    if (unsubState) unsubState()
    if (unsubNewTx) unsubNewTx()

    unsubBalance = walletClient.onBalanceUpdated((balance) => {
      if (typeof balance === 'string') {
        set({ balance })
      }
    })

    unsubNewTx = walletClient.onNewTransaction((tx) => {
      if (!tx || typeof tx !== 'object' || typeof tx.id !== 'string') return
      // Functional set for atomic dedup: two pushes arriving back-to-back both
      // read the same snapshot with get(), so the check-then-set would race.
      set((state) => {
        if (state.transactions.some((t) => t.id === tx.id)) return state
        const next = [tx, ...state.transactions]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, WALLET_TX_DISPLAY_CAP)
        return { transactions: next }
      })
    })

    unsubState = walletClient.onStateChanged((state) => {
      if (state && typeof state === 'object') {
        set({
          isCreated: state.isCreated ?? get().isCreated,
          address: state.address ?? get().address,
          addressRaw: state.addressRaw ?? get().addressRaw,
          publicKey: state.publicKey ?? get().publicKey,
          balance: state.balance ?? get().balance,
          decryptFailed: state.decryptFailed ?? get().decryptFailed,
          weakEncryption: state.weakEncryption ?? get().weakEncryption,
          isLocked: state.isLocked ?? get().isLocked,
          needsPasswordSetup: state.needsPasswordSetup ?? get().needsPasswordSetup,
          passwordProtected: state.passwordProtected ?? get().passwordProtected,
          backupVerified: state.backupVerified ?? get().backupVerified,
        })
      }
    })
  }

  setupListeners()

  return {
    isCreated: false,
    address: '',
    addressRaw: '',
    publicKey: '',
    balance: '0',
    transactions: [],
    isLoading: false,
    isSending: false,
    error: null,
    decryptFailed: false,
    weakEncryption: false,
    isLocked: false,
    needsPasswordSetup: false,
    passwordProtected: false,
    backupVerified: false,
    notificationStyle: 'popup',
    pending402Notification: null,

    setPending402Notification: (data) => set({ pending402Notification: data }),

    approvePending402: async () => {
      const data = get().pending402Notification
      if (!data) return
      set({ pending402Notification: null })
      try {
        await walletClient.approvePayment(data.id)
      } catch {
        // main rolls back on timeout
      }
    },

    rejectPending402: async () => {
      const data = get().pending402Notification
      if (!data) return
      set({ pending402Notification: null })
      try {
        await walletClient.rejectPayment(data.id)
      } catch {
        // idempotent on main
      }
    },

    setError: (error) => set({ error }),

    init: async () => {
      if (get().isCreated || get().isLoading) return
      set({ isLoading: true, error: null })
      try {
        const state = await walletClient.getState()
        if (state) {
          set({
            isCreated: state.isCreated ?? false,
            address: state.address ?? '',
            addressRaw: state.addressRaw ?? '',
            publicKey: state.publicKey ?? '',
            balance: state.balance ?? '0',
            decryptFailed: state.decryptFailed ?? false,
            weakEncryption: state.weakEncryption ?? false,
            isLocked: state.isLocked ?? false,
            needsPasswordSetup: state.needsPasswordSetup ?? false,
            passwordProtected: state.passwordProtected ?? false,
            backupVerified: state.backupVerified ?? false,
          })
        }
        const walletSettings = await walletClient.getSettings()
        if (walletSettings?.notificationStyle) {
          set({ notificationStyle: walletSettings.notificationStyle })
        }
      } catch (err) {
        set({ error: errorMessage(err) })
      } finally {
        set({ isLoading: false })
      }
    },

    create: async (options: { password?: string }) => {
      set({ isLoading: true, error: null })
      try {
        const result = await walletClient.create(options)
        if (result) {
          set({
            isCreated: result.isCreated ?? true,
            address: result.address ?? '',
            addressRaw: result.addressRaw ?? '',
            publicKey: result.publicKey ?? '',
            balance: result.balance ?? '0',
            isLocked: result.isLocked ?? false,
            needsPasswordSetup: result.needsPasswordSetup ?? false,
            passwordProtected: result.passwordProtected ?? false,
            backupVerified: result.backupVerified ?? false,
          })
          return result.mnemonic ?? null
        }
        return null
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      } finally {
        set({ isLoading: false })
      }
    },

    discoverAccounts: (mnemonic: string[]) => walletClient.discoverAccounts(mnemonic),

    importWallet: async (mnemonic: string[], password: string, walletVersion: WalletAccountCandidate['version']) => {
      set({ isLoading: true, error: null })
      try {
        const result = await walletClient.importWallet(mnemonic, password, walletVersion)
        set({
          isCreated: result.isCreated ?? true,
          address: result.address ?? '',
          addressRaw: result.addressRaw ?? '',
          publicKey: result.publicKey ?? '',
          balance: result.balance ?? '0',
          decryptFailed: false,
          weakEncryption: false,
          isLocked: result.isLocked ?? false,
          needsPasswordSetup: result.needsPasswordSetup ?? false,
          passwordProtected: result.passwordProtected ?? false,
          backupVerified: result.backupVerified ?? true,
        })
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      } finally {
        set({ isLoading: false })
      }
    },

    exportMnemonic: async (password?: string) => {
      const result = await walletClient.exportMnemonic(password)
      return result.mnemonic
    },

    unlock: async (password: string) => {
      const state = await walletClient.unlock(password)
      set({ isLocked: state.isLocked ?? false, error: null })
    },

    lock: async () => {
      const state = await walletClient.lock()
      set({ isLocked: state.isLocked ?? true })
    },

    setupPassword: async (password: string) => {
      const state = await walletClient.setupPassword(password)
      set({
        needsPasswordSetup: false,
        passwordProtected: true,
        weakEncryption: false,
        isLocked: state.isLocked ?? false,
      })
    },

    createBackupChallenge: (password?: string) => walletClient.createBackupChallenge(password),

    markBackupVerified: async (challengeId: string, password: string | undefined, answers: string[]) => {
      const state = await walletClient.markBackupVerified(challengeId, password, answers)
      set({ backupVerified: state.backupVerified ?? true })
    },

    changePassword: async (currentPassword: string, nextPassword: string) => {
      const state = await walletClient.changePassword(currentPassword, nextPassword)
      set({ isLocked: state.isLocked ?? false, error: null })
    },

    refreshBalance: async () => {
      try {
        const result = await walletClient.getBalance()
        if (typeof result === 'string') {
          set({ balance: result })
        }
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    send: async (to: string, amount: string, comment?: string, encryptedComment?: boolean) => {
      set({ isSending: true, error: null })
      try {
        await walletClient.send(to, amount, comment, encryptedComment)
        await get().refreshBalance()
        await get().loadHistory()
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      } finally {
        set({ isSending: false })
      }
    },

    loadHistory: async (limit?: number) => {
      try {
        const result = await walletClient.getHistory(limit)
        if (Array.isArray(result)) {
          set({ transactions: result })
        }
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    deleteWallet: async (password: string) => {
      try {
        await walletClient.deleteWallet(password)
        set({
          isCreated: false,
          address: '',
          addressRaw: '',
          publicKey: '',
          balance: '0',
          transactions: [],
          decryptFailed: false,
          weakEncryption: false,
          isLocked: false,
          needsPasswordSetup: false,
          passwordProtected: false,
          backupVerified: false,
          error: null,
        })
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      }
    },

    forgetWallet: async () => {
      try {
        await walletClient.forgetWallet()
        set({
          isCreated: false,
          address: '',
          addressRaw: '',
          publicKey: '',
          balance: '0',
          transactions: [],
          decryptFailed: false,
          weakEncryption: false,
          isLocked: false,
          needsPasswordSetup: false,
          passwordProtected: false,
          backupVerified: false,
          error: null,
        })
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      }
    },

    clearHistory: async () => {
      try {
        await walletClient.clearHistory()
        set({ transactions: [] })
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },
  }
})

// Refresh notificationStyle when wallet settings change
if (walletClient.isAvailable()) {
  const unsubSettings = walletClient.onSettingsChanged((data) => {
    if (data.category === 'wallet' || data.reset) {
      walletClient.getSettings().then((ws) => {
        useWalletStore.setState({ notificationStyle: ws?.notificationStyle ?? 'popup' })
      })
    }
  })
  const hot = import.meta.hot
  if (hot) hot.dispose(() => unsubSettings())
}
