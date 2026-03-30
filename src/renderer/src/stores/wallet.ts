/**
 * Wallet store.
 * Non-persisted runtime wallet state — synced from main via IPC.
 */

import { create } from 'zustand'
import { getIpcError } from '@/lib/ipc-utils'
import type { WalletTransaction } from '@shared/types'

export function formatTonAmount(nanoTon: string): string {
  const ton = BigInt(nanoTon)
  const whole = ton / 1000000000n
  const frac = ton % 1000000000n
  if (frac === 0n) return whole.toString()
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}.${fracStr.slice(0, 4)}`
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
  activeTab: 'overview' | 'send' | 'receive' | 'history' | 'dns' | 'nft'

  init: () => Promise<void>
  create: () => Promise<void>
  importWallet: (mnemonic: string[]) => Promise<void>
  exportMnemonic: () => Promise<string[]>
  refreshBalance: () => Promise<void>
  send: (to: string, amount: string) => Promise<void>
  loadHistory: (limit?: number) => Promise<void>
  clearHistory: () => Promise<void>
  setError: (error: string | null) => void
  setActiveTab: (tab: 'overview' | 'send' | 'receive' | 'history' | 'dns' | 'nft') => void
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

    unsubBalance = window.electron.on('wallet:balance-updated', (...args: unknown[]) => {
      const balance = args[0] as string
      if (typeof balance === 'string') {
        set({ balance })
      }
    })

    unsubNewTx = window.electron.on('wallet:new-transaction', () => {
      // Refresh history when a new transaction arrives via push
      get().loadHistory()
    })

    unsubState = window.electron.on('wallet:state-changed', (...args: unknown[]) => {
      const state = args[0] as {
        isCreated?: boolean
        address?: string
        addressRaw?: string
        publicKey?: string
        balance?: string
      }
      if (state && typeof state === 'object') {
        set({
          isCreated: state.isCreated ?? get().isCreated,
          address: state.address ?? get().address,
          addressRaw: state.addressRaw ?? get().addressRaw,
          publicKey: state.publicKey ?? get().publicKey,
          balance: state.balance ?? get().balance,
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
    activeTab: 'overview',

    setError: (error) => set({ error }),
    setActiveTab: (tab) => set({ activeTab: tab }),

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
        const state = await window.electron.wallet.create()
        const createErr = getIpcError(state)
        if (createErr) throw new Error(createErr)
        if (state) {
          set({
            isCreated: state.isCreated ?? true,
            address: state.address ?? '',
            addressRaw: state.addressRaw ?? '',
            publicKey: state.publicKey ?? '',
            balance: state.balance ?? '0',
          })
        }
      } catch (err) {
        set({ error: (err as Error).message })
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
