/**
 * App preferences store.
 * Runtime UI preferences (non-persisted).
 */

import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'
import type { ThemeType } from '../../../shared/defaults'
import type { AppSettings } from '../../../shared/types'
import { createLogger } from '@/logger'
import { IPC_CHANNELS } from '@shared/ipc-channels'

const log = createLogger('preferences')

export type { ThemeType }

export interface AppPreferences {
  // General
  homepage: string
  resolveEth: boolean
  ethRpc: string
  resolveSol: boolean
  solRpc: string

  // Network
  proxyPort: number
  storagePort: number
  autoConnect: boolean
  connectionTimeout: number
  syncCheckInterval: number
  anonymousMode: boolean
  tunnelMode: 'standard' | 'maximum'

  // Storage
  downloadPath: string
  storagePollingInterval: number
  seedingEnabled: boolean
  downloadSpeedLimit: number
  uploadSpeedLimit: number

  // Appearance
  theme: ThemeType
  language: string
  defaultZoom: number
  zoomMin: number
  zoomMax: number
  showBookmarksBar: boolean
  showStatusBar: boolean
  tabOrientation: 'horizontal' | 'vertical'
  sidebarWidth: number

  // Privacy
  clearOnExit: boolean
  disableCache: boolean
  firstPartyIsolation: boolean
  cookieAutoDelete: boolean
  cookieAutoDeleteMinutes: number
  historyMode: 'memory' | 'persistent'
  historyMaxEntries: number

  // Content Filtering
  contentFilteringEnabled: boolean
  blockAds: boolean
  blockTrackers: boolean
  blockMiners: boolean
  blockMalware: boolean
  blockAnnoyances: boolean
  whitelistedDomains: string[]

  // Advanced
  proxyVerbosity: number
  storageVerbosity: number
  syncTestDomain: string

  // Cocoon AI
  cocoonAutostart: boolean
}

interface PreferencesState {
  // Saved preferences (from main process)
  saved: AppPreferences
  // Draft preferences (current UI state)
  draft: AppPreferences
  // State flags
  isLoaded: boolean
  hasChanges: boolean
  isSaving: boolean

  // Actions
  loadFromMain: () => Promise<void>
  setDraft: <K extends keyof AppPreferences>(key: K, value: AppPreferences[K]) => void
  save: () => Promise<void>
  discard: () => void
  resetToDefaults: () => Promise<void>
}

export const defaultPreferences: AppPreferences = {
  // General
  homepage: DEFAULT_SETTINGS.homepage,
  resolveEth: DEFAULT_SETTINGS.resolveEth,
  ethRpc: DEFAULT_SETTINGS.ethRpc,
  resolveSol: DEFAULT_SETTINGS.resolveSol,
  solRpc: DEFAULT_SETTINGS.solRpc,

  // Network
  proxyPort: DEFAULT_SETTINGS.proxyPort,
  storagePort: DEFAULT_SETTINGS.storagePort,
  autoConnect: DEFAULT_SETTINGS.autoConnect,
  connectionTimeout: DEFAULT_SETTINGS.connectionTimeout,
  syncCheckInterval: DEFAULT_SETTINGS.syncCheckInterval,
  anonymousMode: DEFAULT_SETTINGS.anonymousMode,
  tunnelMode: DEFAULT_SETTINGS.tunnelMode,

  // Storage
  downloadPath: DEFAULT_SETTINGS.downloadPath, // Will be loaded from main
  storagePollingInterval: DEFAULT_SETTINGS.pollingInterval,
  seedingEnabled: DEFAULT_SETTINGS.seedingEnabled,
  downloadSpeedLimit: DEFAULT_SETTINGS.downloadSpeedLimit,
  uploadSpeedLimit: DEFAULT_SETTINGS.uploadSpeedLimit,

  // Appearance
  theme: DEFAULT_SETTINGS.theme,
  language: DEFAULT_SETTINGS.language,
  defaultZoom: DEFAULT_SETTINGS.defaultZoom,
  zoomMin: DEFAULT_SETTINGS.zoomMin,
  zoomMax: DEFAULT_SETTINGS.zoomMax,
  showBookmarksBar: DEFAULT_SETTINGS.showBookmarksBar,
  showStatusBar: DEFAULT_SETTINGS.showStatusBar,
  tabOrientation: DEFAULT_SETTINGS.tabOrientation,
  sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,

  // Privacy
  clearOnExit: DEFAULT_SETTINGS.clearOnExit,
  disableCache: DEFAULT_SETTINGS.disableCache,
  firstPartyIsolation: DEFAULT_SETTINGS.firstPartyIsolation,
  historyMode: DEFAULT_SETTINGS.historyMode,
  historyMaxEntries: DEFAULT_SETTINGS.historyMaxEntries,
  cookieAutoDelete: DEFAULT_SETTINGS.cookieAutoDelete,
  cookieAutoDeleteMinutes: DEFAULT_SETTINGS.cookieAutoDeleteMinutes,

  // Content Filtering
  contentFilteringEnabled: DEFAULT_SETTINGS.contentFiltering.enabled,
  blockAds: DEFAULT_SETTINGS.contentFiltering.blockAds,
  blockTrackers: DEFAULT_SETTINGS.contentFiltering.blockTrackers,
  blockMiners: DEFAULT_SETTINGS.contentFiltering.blockMiners,
  blockMalware: DEFAULT_SETTINGS.contentFiltering.blockMalware,
  blockAnnoyances: DEFAULT_SETTINGS.contentFiltering.blockAnnoyances,
  whitelistedDomains: DEFAULT_SETTINGS.contentFiltering.whitelistedDomains,

  // Advanced
  proxyVerbosity: DEFAULT_SETTINGS.proxyVerbosity,
  storageVerbosity: DEFAULT_SETTINGS.storageVerbosity,
  syncTestDomain: DEFAULT_SETTINGS.syncTestDomain,

  // Cocoon AI
  cocoonAutostart: DEFAULT_SETTINGS.cocoon.autostart,
}

// Map flat preferences to categorized main process structure
const prefToCategory: Record<keyof AppPreferences, { category: string; field: string }> = {
  homepage: { category: 'general', field: 'homepage' },
  resolveEth: { category: 'general', field: 'resolveEth' },
  ethRpc: { category: 'general', field: 'ethRpc' },
  resolveSol: { category: 'general', field: 'resolveSol' },
  solRpc: { category: 'general', field: 'solRpc' },
  proxyPort: { category: 'network', field: 'proxyPort' },
  storagePort: { category: 'network', field: 'storagePort' },
  autoConnect: { category: 'network', field: 'autoConnect' },
  connectionTimeout: { category: 'network', field: 'connectionTimeout' },
  syncCheckInterval: { category: 'network', field: 'syncCheckInterval' },
  anonymousMode: { category: 'network', field: 'anonymousMode' },
  tunnelMode: { category: 'network', field: 'tunnelMode' },
  downloadPath: { category: 'storage', field: 'downloadPath' },
  storagePollingInterval: { category: 'storage', field: 'pollingInterval' },
  seedingEnabled: { category: 'storage', field: 'seedingEnabled' },
  downloadSpeedLimit: { category: 'storage', field: 'downloadSpeedLimit' },
  uploadSpeedLimit: { category: 'storage', field: 'uploadSpeedLimit' },
  theme: { category: 'appearance', field: 'theme' },
  language: { category: 'appearance', field: 'language' },
  defaultZoom: { category: 'appearance', field: 'defaultZoom' },
  zoomMin: { category: 'appearance', field: 'zoomMin' },
  zoomMax: { category: 'appearance', field: 'zoomMax' },
  showBookmarksBar: { category: 'appearance', field: 'showBookmarksBar' },
  showStatusBar: { category: 'appearance', field: 'showStatusBar' },
  tabOrientation: { category: 'appearance', field: 'tabOrientation' },
  sidebarWidth: { category: 'appearance', field: 'sidebarWidth' },
  clearOnExit: { category: 'privacy', field: 'clearOnExit' },
  disableCache: { category: 'privacy', field: 'disableCache' },
  firstPartyIsolation: { category: 'privacy', field: 'firstPartyIsolation' },
  cookieAutoDelete: { category: 'privacy', field: 'cookieAutoDelete' },
  cookieAutoDeleteMinutes: { category: 'privacy', field: 'cookieAutoDeleteMinutes' },
  historyMode: { category: 'privacy', field: 'historyMode' },
  historyMaxEntries: { category: 'privacy', field: 'historyMaxEntries' },
  contentFilteringEnabled: { category: 'contentFiltering', field: 'enabled' },
  blockAds: { category: 'contentFiltering', field: 'blockAds' },
  blockTrackers: { category: 'contentFiltering', field: 'blockTrackers' },
  blockMiners: { category: 'contentFiltering', field: 'blockMiners' },
  blockMalware: { category: 'contentFiltering', field: 'blockMalware' },
  blockAnnoyances: { category: 'contentFiltering', field: 'blockAnnoyances' },
  whitelistedDomains: { category: 'contentFiltering', field: 'whitelistedDomains' },
  proxyVerbosity: { category: 'advanced', field: 'proxyVerbosity' },
  storageVerbosity: { category: 'advanced', field: 'storageVerbosity' },
  syncTestDomain: { category: 'advanced', field: 'syncTestDomain' },
  cocoonAutostart: { category: 'cocoon', field: 'autostart' },
}

// Convert main process settings to flat preferences. Derived from the single
// prefToCategory mapping (+ defaultPreferences for fallbacks) so the
// settings->prefs wiring is declared once rather than re-spelled per field.
function mainSettingsToPrefs(settings: AppSettings): AppPreferences {
  const result = {} as Record<keyof AppPreferences, unknown>
  for (const key of Object.keys(prefToCategory) as (keyof AppPreferences)[]) {
    const { category, field } = prefToCategory[key]
    const categoryValues = settings[category as keyof AppSettings] as Record<string, unknown> | undefined
    result[key] = categoryValues?.[field] ?? defaultPreferences[key]
  }
  return result as AppPreferences
}

/**
 * Value-equality for a single preference. Arrays (e.g. whitelistedDomains) are
 * compared by content, everything else by identity. Used by BOTH the dirty
 * check and the save() diff so they can never disagree.
 */
function prefValueChanged(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) !== JSON.stringify(b)
  }
  return a !== b
}

// Check if two preferences objects are different
function hasPreferencesChanged(a: AppPreferences, b: AppPreferences): boolean {
  for (const key of Object.keys(a) as (keyof AppPreferences)[]) {
    if (prefValueChanged(a[key], b[key])) return true
  }
  return false
}

// Selector to get current applied preferences (from saved)
export const usePreferences = () => {
  const saved = usePreferencesStore((state) => state.saved)
  return saved
}

export const usePreferencesStore = create<PreferencesState>()((set, get) => ({
  saved: { ...defaultPreferences },
  draft: { ...defaultPreferences },
  isLoaded: false,
  hasChanges: false,
  isSaving: false,

  loadFromMain: async () => {
    // Reset isLoaded to show loading state while fetching
    set({ isLoaded: false })
    try {
      const settings = await window.electron.settings.getAll()
      const prefs = mainSettingsToPrefs(settings)
      set({ saved: prefs, draft: { ...prefs }, isLoaded: true, hasChanges: false })
    } catch (error) {
      log.error('Failed to load from main:', error)
      set({ isLoaded: true })
    }
  },

  setDraft: (key, value) => {
    const { saved, draft } = get()
    const newDraft = { ...draft, [key]: value }
    set({
      draft: newDraft,
      hasChanges: hasPreferencesChanged(saved, newDraft),
    })
  },

  save: async () => {
    const { draft, saved } = get()
    set({ isSaving: true })

    // Find changed values and group by category
    const categoryUpdates: Record<string, Record<string, AppPreferences[keyof AppPreferences]>> = {}
    for (const key of Object.keys(draft) as (keyof AppPreferences)[]) {
      if (prefValueChanged(draft[key], saved[key])) {
        const { category, field } = prefToCategory[key]
        if (!categoryUpdates[category]) {
          categoryUpdates[category] = {}
        }
        categoryUpdates[category][field] = draft[key]
      }
    }

    // Sync all changed categories to main process in parallel
    try {
      await Promise.all(
        Object.entries(categoryUpdates).map(([category, values]) => window.electron.settings.set(category, values))
      )
      set({ saved: { ...draft }, hasChanges: false, isSaving: false })
    } catch (error) {
      log.error('Failed to save:', error)
      set({ isSaving: false })
    }
  },

  discard: () => {
    const { saved } = get()
    set({ draft: { ...saved }, hasChanges: false })
  },

  resetToDefaults: async () => {
    set({ isSaving: true })
    try {
      await window.electron.settings.reset()
      set({
        saved: { ...defaultPreferences },
        draft: { ...defaultPreferences },
        hasChanges: false,
        isSaving: false,
      })
    } catch (error) {
      log.error('Failed to reset:', error)
      set({ isSaving: false })
    }
  },
}))

// Listen for settings changes from main process
if (typeof window !== 'undefined' && window.electron) {
  const unsubscribe = window.electron.on(IPC_CHANNELS.SETTINGS_CHANGED, (data) => {
    if (data.reset) {
      usePreferencesStore.setState({
        saved: { ...defaultPreferences },
        draft: { ...defaultPreferences },
        hasChanges: false,
      })
    }
  })

  // Cleanup listener on HMR module replacement
  const hot = import.meta.hot
  if (hot) {
    hot.dispose(() => unsubscribe())
  }
}
