/**
 * Wallet store.
 * Non-persisted runtime wallet state — synced from main via IPC.
 */

import { create } from 'zustand'
import { getIpcError } from '@/lib/ipc-utils'
import type { WalletTransaction } from '@shared/types'
import { WALLET_TX_DISPLAY_CAP } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc-channels'

export function formatTonAmount(nanoTon: string): string {
  if (!nanoTon) return '0'
  try {
    const ton = BigInt(nanoTon)
    const whole = ton / 1000000000n
    const frac = ton % 1000000000n
    if (frac === 0n) return whole.toString()
    const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
    return `${whole}.${fracStr.slice(0, 4)}`
  } catch {
    return '0'
  }
}

export function tonToNano(ton: string): string {
  if (!ton || ton.startsWith('-')) throw new Error('Invalid amount')
  const parts = ton.split('.')
  const whole = BigInt(parts[0] || '0') * 1000000000n
  if (!parts[1]) return whole.toString()
  const fracStr = parts[1].padEnd(9, '0').slice(0, 9)
  return (whole + BigInt(fracStr)).toString()
}

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
  init: () => Promise<void>
  create: () => Promise<string[] | null>
  importWallet: (mnemonic: string[]) => Promise<void>
  exportMnemonic: () => Promise<string[]>
  refreshBalance: () => Promise<void>
  send: (to: string, amount: string) => Promise<void>
  loadHistory: (limit?: number) => Promise<void>
  clearHistory: () => Promise<void>
  deleteWallet: () => Promise<void>
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

    unsubBalance = window.electron.on(IPC_CHANNELS.WALLET_BALANCE_UPDATED, (...args: unknown[]) => {
      const balance = args[0] as string
      if (typeof balance === 'string') {
        set({ balance })
      }
    })

    unsubNewTx = window.electron.on(IPC_CHANNELS.WALLET_NEW_TRANSACTION, (...args: unknown[]) => {
      const tx = args[0] as WalletTransaction | undefined
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

    unsubState = window.electron.on(IPC_CHANNELS.WALLET_STATE_CHANGED, (...args: unknown[]) => {
      const state = args[0] as {
        isCreated?: boolean
        address?: string
        addressRaw?: string
        publicKey?: string
        balance?: string
        decryptFailed?: boolean
        weakEncryption?: boolean
      }
      if (state && typeof state === 'object') {
        set({
          isCreated: state.isCreated ?? get().isCreated,
          address: state.address ?? get().address,
          addressRaw: state.addressRaw ?? get().addressRaw,
          publicKey: state.publicKey ?? get().publicKey,
          balance: state.balance ?? get().balance,
          decryptFailed: state.decryptFailed ?? get().decryptFailed,
          weakEncryption: state.weakEncryption ?? get().weakEncryption,
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

    setError: (error) => set({ error }),

    init: async () => {
      if (get().isCreated || get().isLoading) return
      set({ isLoading: true, error: null })
      try {
        const state = await window.electron.wallet.getState()
        const stateErr = getIpcError(state)
        if (stateErr) throw new Error(stateErr)
        if (state) {
          set({
            isCreated: state.isCreated ?? false,
            address: state.address ?? '',
            addressRaw: state.addressRaw ?? '',
            publicKey: state.publicKey ?? '',
            balance: state.balance ?? '0',
            decryptFailed: state.decryptFailed ?? false,
            weakEncryption: state.weakEncryption ?? false,
          })
        }
      } catch (err) {
        set({ error: (err as Error).message })
      } finally {
        set({ isLoading: false })
      }
    },

    create: async () => {
      set({ isLoading: true, error: null })
      try {
        const result = await window.electron.wallet.create()
        const createErr = getIpcError(result)
        if (createErr) throw new Error(createErr)
        if (result) {
          set({
            isCreated: result.isCreated ?? true,
            address: result.address ?? '',
            addressRaw: result.addressRaw ?? '',
            publicKey: result.publicKey ?? '',
            balance: result.balance ?? '0',
          })
          return result.mnemonic ?? null
        }
        return null
      } catch (err) {
        set({ error: (err as Error).message })
        return null
      } finally {
        set({ isLoading: false })
      }
    },

    importWallet: async (mnemonic: string[]) => {
      set({ isLoading: true, error: null })
      try {
        const result = await window.electron.wallet.importWallet(mnemonic)
        const err = getIpcError(result)
        if (err) throw new Error(err)
        set({
          isCreated: result.isCreated ?? true,
          address: result.address ?? '',
          addressRaw: result.addressRaw ?? '',
          publicKey: result.publicKey ?? '',
          balance: result.balance ?? '0',
          decryptFailed: false,
          weakEncryption: false,
        })
      } catch (err) {
        set({ error: (err as Error).message })
        throw err
      } finally {
        set({ isLoading: false })
      }
    },

    exportMnemonic: async () => {
      const result = await window.electron.wallet.exportMnemonic()
      const err = getIpcError(result)
      if (err) throw new Error(err)
      return result.mnemonic
    },

    refreshBalance: async () => {
      try {
        const result = await window.electron.wallet.getBalance()
        if (getIpcError(result)) return
        if (typeof result === 'string') {
          set({ balance: result })
        }
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    send: async (to: string, amount: string) => {
      set({ isSending: true, error: null })
      try {
        const result = await window.electron.wallet.send(to, amount)
        const sendErr = getIpcError(result)
        if (sendErr) throw new Error(sendErr)
        await get().refreshBalance()
        await get().loadHistory()
      } catch (err) {
        set({ error: (err as Error).message })
        throw err
      } finally {
        set({ isSending: false })
      }
    },

    loadHistory: async (limit?: number) => {
      try {
        const result = await window.electron.wallet.getHistory(limit)
        const histErr = getIpcError(result)
        if (histErr) {
          set({ error: histErr })
          return
        }
        if (Array.isArray(result)) {
          set({ transactions: result })
        }
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    deleteWallet: async () => {
      try {
        const result = await window.electron.wallet.deleteWallet()
        const err = getIpcError(result)
        if (err) throw new Error(err)
        set({
          isCreated: false,
          address: '',
          addressRaw: '',
          publicKey: '',
          balance: '0',
          transactions: [],
          decryptFailed: false,
          weakEncryption: false,
          error: null,
        })
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    clearHistory: async () => {
      try {
        await window.electron.wallet.clearHistory()
        set({ transactions: [] })
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },
  }
})
