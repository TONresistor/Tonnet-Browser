/**
 * App preferences store.
 * Runtime UI preferences (non-persisted).
 */

import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'
import type { ThemeType } from '../../../shared/defaults'
import type { AppSettings } from '../../../shared/types'
import { createLogger } from '@/logger'

const log = createLogger('preferences')

export type { ThemeType }

export interface AppPreferences {
  // General
  homepage: string

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
}

// Map flat preferences to categorized main process structure
const prefToCategory: Record<keyof AppPreferences, { category: string; field: string }> = {
  homepage: { category: 'general', field: 'homepage' },
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
}

// Convert main process settings to flat preferences
function mainSettingsToPrefs(settings: AppSettings): AppPreferences {
  return {
    homepage: settings.general?.homepage ?? defaultPreferences.homepage,
    proxyPort: settings.network?.proxyPort ?? defaultPreferences.proxyPort,
    storagePort: settings.network?.storagePort ?? defaultPreferences.storagePort,
    autoConnect: settings.network?.autoConnect ?? defaultPreferences.autoConnect,
    connectionTimeout: settings.network?.connectionTimeout ?? defaultPreferences.connectionTimeout,
    syncCheckInterval: settings.network?.syncCheckInterval ?? defaultPreferences.syncCheckInterval,
    anonymousMode: settings.network?.anonymousMode ?? defaultPreferences.anonymousMode,
    tunnelMode: (settings.network?.tunnelMode ?? defaultPreferences.tunnelMode) as 'standard' | 'maximum',
    downloadPath: settings.storage?.downloadPath ?? defaultPreferences.downloadPath,
    storagePollingInterval: settings.storage?.pollingInterval ?? defaultPreferences.storagePollingInterval,
    seedingEnabled: settings.storage?.seedingEnabled ?? defaultPreferences.seedingEnabled,
    downloadSpeedLimit: settings.storage?.downloadSpeedLimit ?? defaultPreferences.downloadSpeedLimit,
    uploadSpeedLimit: settings.storage?.uploadSpeedLimit ?? defaultPreferences.uploadSpeedLimit,
    theme: (settings.appearance?.theme ?? defaultPreferences.theme) as ThemeType,
    language: settings.appearance?.language ?? defaultPreferences.language,
    defaultZoom: settings.appearance?.defaultZoom ?? defaultPreferences.defaultZoom,
    zoomMin: settings.appearance?.zoomMin ?? defaultPreferences.zoomMin,
    zoomMax: settings.appearance?.zoomMax ?? defaultPreferences.zoomMax,
    showBookmarksBar: settings.appearance?.showBookmarksBar ?? defaultPreferences.showBookmarksBar,
    showStatusBar: settings.appearance?.showStatusBar ?? defaultPreferences.showStatusBar,
    tabOrientation: settings.appearance?.tabOrientation ?? defaultPreferences.tabOrientation,
    sidebarWidth: settings.appearance?.sidebarWidth ?? defaultPreferences.sidebarWidth,
    clearOnExit: settings.privacy?.clearOnExit ?? defaultPreferences.clearOnExit,
    historyMode: settings.privacy?.historyMode ?? defaultPreferences.historyMode,
    historyMaxEntries: settings.privacy?.historyMaxEntries ?? defaultPreferences.historyMaxEntries,
    disableCache: settings.privacy?.disableCache ?? defaultPreferences.disableCache,
    firstPartyIsolation: settings.privacy?.firstPartyIsolation ?? defaultPreferences.firstPartyIsolation,
    cookieAutoDelete: settings.privacy?.cookieAutoDelete ?? defaultPreferences.cookieAutoDelete,
    cookieAutoDeleteMinutes: settings.privacy?.cookieAutoDeleteMinutes ?? defaultPreferences.cookieAutoDeleteMinutes,
    contentFilteringEnabled: settings.contentFiltering?.enabled ?? defaultPreferences.contentFilteringEnabled,
    blockAds: settings.contentFiltering?.blockAds ?? defaultPreferences.blockAds,
    blockTrackers: settings.contentFiltering?.blockTrackers ?? defaultPreferences.blockTrackers,
    blockMiners: settings.contentFiltering?.blockMiners ?? defaultPreferences.blockMiners,
    blockMalware: settings.contentFiltering?.blockMalware ?? defaultPreferences.blockMalware,
    blockAnnoyances: settings.contentFiltering?.blockAnnoyances ?? defaultPreferences.blockAnnoyances,
    whitelistedDomains: settings.contentFiltering?.whitelistedDomains ?? defaultPreferences.whitelistedDomains,
    proxyVerbosity: settings.advanced?.proxyVerbosity ?? defaultPreferences.proxyVerbosity,
    storageVerbosity: settings.advanced?.storageVerbosity ?? defaultPreferences.storageVerbosity,
    syncTestDomain: settings.advanced?.syncTestDomain ?? defaultPreferences.syncTestDomain,
  }
}

// Check if two preferences objects are different
function hasPreferencesChanged(a: AppPreferences, b: AppPreferences): boolean {
  for (const key of Object.keys(a) as (keyof AppPreferences)[]) {
    if (Array.isArray(a[key]) && Array.isArray(b[key])) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return true
    } else if (a[key] !== b[key]) return true
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
      if (draft[key] !== saved[key]) {
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
  const unsubscribe = window.electron.on('settings:changed', (...args: unknown[]) => {
    const data = args[0] as { reset?: boolean; category?: string; values?: object }
    if (data.reset) {
      usePreferencesStore.setState({
        saved: { ...defaultPreferences },
        draft: { ...defaultPreferences },
        hasChanges: false,
      })
    }
  })

  // Cleanup listener on HMR module replacement
  const hot = (import.meta as unknown as Record<string, unknown>).hot as
    | { dispose: (cb: () => void) => void }
    | undefined
  if (hot) {
    hot.dispose(() => unsubscribe())
  }
}
