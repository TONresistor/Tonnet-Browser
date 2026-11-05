/**
 * Wallet store.
 * Non-persisted runtime wallet state — synced from main via IPC.
 */

import { errorMessage } from '@shared/errors'
import { create } from 'zustand'
import type { WalletTransaction, WalletSnapshot, PaymentNotificationData, NotificationStyle } from '@shared/types'
import { WALLET_TX_DISPLAY_CAP } from '@shared/constants'
import { walletClient } from '@/features/wallet/client'
import type { WalletAccountCandidate } from '@shared/ipc-contract/wallet'

interface WalletStore {
  snapshotRevision: number
  sessionRevision: number
  isCreated: boolean
  address: string
  addressRaw: string
  publicKey: string
  balance: string
  transactions: WalletTransaction[]
  isLoading: boolean
  initialized: boolean
  isSending: boolean
  error: string | null
  decryptFailed: boolean
  systemStorageBlocked: boolean
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

const PENDING_SEND_KEY = 'wallet-pending-send'
function pendingSend(): { id: string; intent: string } | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_SEND_KEY) ?? 'null')
    return typeof saved?.id === 'string' && typeof saved.intent === 'string' ? saved : null
  } catch {
    return null
  }
}
function forgetPendingSend(id: string): void {
  try {
    if (pendingSend()?.id === id) sessionStorage.removeItem(PENDING_SEND_KEY)
  } catch {
    /* The engine also protects unresolved sends when browser storage is unavailable. */
  }
}
function confirmedSend(transactions: readonly WalletTransaction[], id: string): boolean {
  return transactions.some(
    (transaction) => (transaction.operationId === id || transaction.id === id) && transaction.status === 'confirmed'
  )
}

export const useWalletStore = create<WalletStore>((set, get) => {
  const applySnapshot = (snapshot: WalletSnapshot): void => {
    let accepted = false
    set((current) => {
      if (snapshot.revision <= current.snapshotRevision) return current
      accepted = true
      return {
        snapshotRevision: snapshot.revision,
        sessionRevision: snapshot.sessionRevision,
        isCreated: snapshot.isCreated,
        address: snapshot.address,
        addressRaw: snapshot.addressRaw,
        publicKey: snapshot.publicKey,
        balance: snapshot.balance,
        transactions: snapshot.transactions.slice(0, WALLET_TX_DISPLAY_CAP),
        decryptFailed: snapshot.decryptFailed ?? false,
        systemStorageBlocked: snapshot.systemStorageBlocked ?? false,
        weakEncryption: snapshot.weakEncryption ?? false,
        isLocked: snapshot.isLocked ?? false,
        needsPasswordSetup: snapshot.needsPasswordSetup ?? false,
        passwordProtected: snapshot.passwordProtected ?? false,
        backupVerified: snapshot.backupVerified ?? false,
      }
    })
    const saved = accepted ? pendingSend() : null
    if (saved && confirmedSend(snapshot.transactions, saved.id)) forgetPendingSend(saved.id)
  }
  const refreshSnapshot = async (): Promise<void> => applySnapshot(await walletClient.getSnapshot())
  const unsubscribe = walletClient.onSnapshotChanged(applySnapshot)
  if (import.meta.hot) import.meta.hot.dispose(unsubscribe)

  return {
    snapshotRevision: -1,
    sessionRevision: 0,
    isCreated: false,
    address: '',
    addressRaw: '',
    publicKey: '',
    balance: '0',
    transactions: [],
    isLoading: false,
    initialized: false,
    isSending: false,
    error: null,
    decryptFailed: false,
    systemStorageBlocked: false,
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
      if (get().initialized || get().isLoading) return
      set({ isLoading: true, error: null })
      try {
        await refreshSnapshot()
        const walletSettings = await walletClient.getSettings()
        if (walletSettings?.notificationStyle) {
          set({ notificationStyle: walletSettings.notificationStyle })
        }
        set({ initialized: true })
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
          await refreshSnapshot()
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
        await walletClient.importWallet(mnemonic, password, walletVersion)
        await refreshSnapshot()
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
      await walletClient.unlock(password)
      await refreshSnapshot()
      set({ error: null })
    },

    lock: async () => {
      await walletClient.lock()
      await refreshSnapshot()
    },

    setupPassword: async (password: string) => {
      await walletClient.setupPassword(password)
      await refreshSnapshot()
    },

    createBackupChallenge: (password?: string) => walletClient.createBackupChallenge(password),

    markBackupVerified: async (challengeId: string, password: string | undefined, answers: string[]) => {
      await walletClient.markBackupVerified(challengeId, password, answers)
      await refreshSnapshot()
    },

    changePassword: async (currentPassword: string, nextPassword: string) => {
      await walletClient.changePassword(currentPassword, nextPassword)
      await refreshSnapshot()
      set({ error: null })
    },

    refreshBalance: async () => {
      try {
        await walletClient.getBalance()
        await refreshSnapshot()
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    send: async (to: string, amount: string, comment?: string, encryptedComment?: boolean) => {
      const saved = pendingSend()
      const completedAtEntry = saved ? confirmedSend(get().transactions, saved.id) : false
      const intent = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(JSON.stringify([to, amount, comment, encryptedComment]))
          )
        ),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join('')
      let operationId: string = crypto.randomUUID()
      try {
        if (saved?.intent === intent && !completedAtEntry) operationId = saved.id
        sessionStorage.setItem(PENDING_SEND_KEY, JSON.stringify({ intent, id: operationId }))
      } catch {
        /* the engine also guards unresolved operations */
      }
      set({ isSending: true, error: null })
      try {
        const transaction = await walletClient.send(to, amount, comment, encryptedComment, operationId)
        if (transaction.status !== 'pending') forgetPendingSend(operationId)
        void refreshSnapshot().catch(() => undefined)
        if (transaction.status === 'failed')
          throw new Error(
            transaction.operationState === 'expired' ? 'Transfer expired without execution' : 'Transfer failed'
          )
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      } finally {
        set({ isSending: false })
      }
    },

    loadHistory: async (limit?: number) => {
      try {
        await walletClient.getHistory(limit)
        await refreshSnapshot()
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    deleteWallet: async (password: string) => {
      try {
        await walletClient.deleteWallet(password)
        await refreshSnapshot()
        set({ error: null })
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      }
    },

    forgetWallet: async () => {
      try {
        await walletClient.forgetWallet()
        await refreshSnapshot()
        set({ error: null })
      } catch (err) {
        set({ error: errorMessage(err) })
        throw err
      }
    },

    clearHistory: async () => {
      try {
        await walletClient.clearHistory()
        await refreshSnapshot()
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
