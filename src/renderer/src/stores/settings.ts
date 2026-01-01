/**
 * Settings store.
 * Application settings synced with main process.
 */

import { create } from 'zustand'

interface StorageStats {
  bagsCount: number
  downloadSpeed: number
  uploadSpeed: number
}

interface SettingsState {
  proxyConnected: boolean
  proxySyncing: boolean
  proxyPort: number
  anonymousMode: boolean
  circuitRelays: string[]
  isLoading: boolean
  currentUrl: string
  currentTitle: string
  canGoBack: boolean
  canGoForward: boolean
  storageStats: StorageStats

  setProxyStatus: (connected: boolean, syncing?: boolean, port?: number, anonymousMode?: boolean, circuitRelays?: string[]) => void
  setLoading: (loading: boolean) => void
  setNavigation: (url: string, canGoBack: boolean, canGoForward: boolean) => void
  setTitle: (title: string) => void
  setStorageStats: (stats: StorageStats) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  proxyConnected: false,
  proxySyncing: false,
  proxyPort: 8080,
  anonymousMode: false,
  circuitRelays: [],
  isLoading: false,
  currentUrl: 'ton://start',
  currentTitle: 'TON Browser',
  canGoBack: false,
  canGoForward: false,
  storageStats: { bagsCount: 0, downloadSpeed: 0, uploadSpeed: 0 },

  setProxyStatus: (connected, syncing, port, anonymousMode, circuitRelays) =>
    set((state) => ({
      proxyConnected: connected,
      proxySyncing: syncing ?? false,
      proxyPort: port ?? state.proxyPort,
      anonymousMode: anonymousMode ?? state.anonymousMode,
      circuitRelays: circuitRelays ?? state.circuitRelays,
    })),

  setLoading: (isLoading) => set({ isLoading }),

  setNavigation: (currentUrl, canGoBack, canGoForward) =>
    set({ currentUrl, canGoBack, canGoForward }),

  setTitle: (currentTitle) => set({ currentTitle }),

  setStorageStats: (storageStats) => set({ storageStats }),
}))
