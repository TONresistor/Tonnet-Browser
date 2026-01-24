/**
 * App preferences store.
 * Runtime UI preferences (non-persisted).
 */

import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../../shared/defaults'
import type { ThemeType } from '../../../shared/defaults'

export type { ThemeType }

export interface AppPreferences {
  // General
  homepage: string
  restoreTabs: boolean

  // Network
  proxyPort: number
  storagePort: number
  autoConnect: boolean
  connectionTimeout: number
  syncCheckInterval: number
  anonymousMode: boolean
  circuitRotation: boolean
  rotateInterval: string

  // Storage
  downloadPath: string
  storagePollingInterval: number

  // Appearance
  theme: ThemeType
  language: string
  defaultZoom: number
  zoomMin: number
  zoomMax: number
  showBookmarksBar: boolean
  showStatusBar: boolean
  tabOrientation: 'horizontal' | 'vertical'

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
  restoreTabs: DEFAULT_SETTINGS.restoreTabs,

  // Network
  proxyPort: DEFAULT_SETTINGS.proxyPort,
  storagePort: DEFAULT_SETTINGS.storagePort,
  autoConnect: DEFAULT_SETTINGS.autoConnect,
  connectionTimeout: DEFAULT_SETTINGS.connectionTimeout,
  syncCheckInterval: DEFAULT_SETTINGS.syncCheckInterval,
  anonymousMode: DEFAULT_SETTINGS.anonymousMode,
  circuitRotation: DEFAULT_SETTINGS.circuitRotation,
  rotateInterval: DEFAULT_SETTINGS.rotateInterval,

  // Storage
  downloadPath: DEFAULT_SETTINGS.downloadPath, // Will be loaded from main
  storagePollingInterval: DEFAULT_SETTINGS.pollingInterval,

  // Appearance
  theme: DEFAULT_SETTINGS.theme,
  language: DEFAULT_SETTINGS.language,
  defaultZoom: DEFAULT_SETTINGS.defaultZoom,
  zoomMin: DEFAULT_SETTINGS.zoomMin,
  zoomMax: DEFAULT_SETTINGS.zoomMax,
  showBookmarksBar: DEFAULT_SETTINGS.showBookmarksBar,
  showStatusBar: DEFAULT_SETTINGS.showStatusBar,
  tabOrientation: DEFAULT_SETTINGS.tabOrientation,

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
  restoreTabs: { category: 'general', field: 'restoreTabs' },
  proxyPort: { category: 'network', field: 'proxyPort' },
  storagePort: { category: 'network', field: 'storagePort' },
  autoConnect: { category: 'network', field: 'autoConnect' },
  connectionTimeout: { category: 'network', field: 'connectionTimeout' },
  syncCheckInterval: { category: 'network', field: 'syncCheckInterval' },
  anonymousMode: { category: 'network', field: 'anonymousMode' },
  circuitRotation: { category: 'network', field: 'circuitRotation' },
  rotateInterval: { category: 'network', field: 'rotateInterval' },
  downloadPath: { category: 'storage', field: 'downloadPath' },
  storagePollingInterval: { category: 'storage', field: 'pollingInterval' },
  theme: { category: 'appearance', field: 'theme' },
  language: { category: 'appearance', field: 'language' },
  defaultZoom: { category: 'appearance', field: 'defaultZoom' },
  zoomMin: { category: 'appearance', field: 'zoomMin' },
  zoomMax: { category: 'appearance', field: 'zoomMax' },
  showBookmarksBar: { category: 'appearance', field: 'showBookmarksBar' },
  showStatusBar: { category: 'appearance', field: 'showStatusBar' },
  tabOrientation: { category: 'appearance', field: 'tabOrientation' },
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
function mainSettingsToPrefs(settings: any): AppPreferences {
  return {
    homepage: settings.general?.homepage ?? defaultPreferences.homepage,
    restoreTabs: settings.general?.restoreTabs ?? defaultPreferences.restoreTabs,
    proxyPort: settings.network?.proxyPort ?? defaultPreferences.proxyPort,
    storagePort: settings.network?.storagePort ?? defaultPreferences.storagePort,
    autoConnect: settings.network?.autoConnect ?? defaultPreferences.autoConnect,
    connectionTimeout: settings.network?.connectionTimeout ?? defaultPreferences.connectionTimeout,
    syncCheckInterval: settings.network?.syncCheckInterval ?? defaultPreferences.syncCheckInterval,
    anonymousMode: settings.network?.anonymousMode ?? defaultPreferences.anonymousMode,
    circuitRotation: settings.network?.circuitRotation ?? defaultPreferences.circuitRotation,
    rotateInterval: settings.network?.rotateInterval ?? defaultPreferences.rotateInterval,
    downloadPath: settings.storage?.downloadPath ?? defaultPreferences.downloadPath,
    storagePollingInterval: settings.storage?.pollingInterval ?? defaultPreferences.storagePollingInterval,
    theme: settings.appearance?.theme ?? defaultPreferences.theme,
    language: settings.appearance?.language ?? defaultPreferences.language,
    defaultZoom: settings.appearance?.defaultZoom ?? defaultPreferences.defaultZoom,
    zoomMin: settings.appearance?.zoomMin ?? defaultPreferences.zoomMin,
    zoomMax: settings.appearance?.zoomMax ?? defaultPreferences.zoomMax,
    showBookmarksBar: settings.appearance?.showBookmarksBar ?? defaultPreferences.showBookmarksBar,
    showStatusBar: settings.appearance?.showStatusBar ?? defaultPreferences.showStatusBar,
    tabOrientation: settings.appearance?.tabOrientation ?? defaultPreferences.tabOrientation,
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
    if (a[key] !== b[key]) return true
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
      console.error('[Preferences] Failed to load from main:', error)
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
    const categoryUpdates: Record<string, Record<string, any>> = {}
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
        Object.entries(categoryUpdates).map(([category, values]) =>
          window.electron.settings.set(category, values)
        )
      )
      set({ saved: { ...draft }, hasChanges: false, isSaving: false })
    } catch (error) {
      console.error('[Preferences] Failed to save:', error)
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
      console.error('[Preferences] Failed to reset:', error)
      set({ isSaving: false })
    }
  },
}))

// Listen for settings changes from main process
if (typeof window !== 'undefined' && window.electron) {
  window.electron.on('settings:changed', (data: any) => {
    if (data.reset) {
      usePreferencesStore.setState({
        saved: { ...defaultPreferences },
        draft: { ...defaultPreferences },
        hasChanges: false,
      })
    }
  })
}
