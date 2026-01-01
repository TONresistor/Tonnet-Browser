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
  defaultZoom: number
  zoomMin: number
  zoomMax: number
  showBookmarksBar: boolean
  showStatusBar: boolean

  // Privacy
  clearOnExit: boolean

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
  defaultZoom: DEFAULT_SETTINGS.defaultZoom,
  zoomMin: DEFAULT_SETTINGS.zoomMin,
  zoomMax: DEFAULT_SETTINGS.zoomMax,
  showBookmarksBar: DEFAULT_SETTINGS.showBookmarksBar,
  showStatusBar: DEFAULT_SETTINGS.showStatusBar,

  // Privacy
  clearOnExit: DEFAULT_SETTINGS.clearOnExit,

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
  defaultZoom: { category: 'appearance', field: 'defaultZoom' },
  zoomMin: { category: 'appearance', field: 'zoomMin' },
  zoomMax: { category: 'appearance', field: 'zoomMax' },
  showBookmarksBar: { category: 'appearance', field: 'showBookmarksBar' },
  showStatusBar: { category: 'appearance', field: 'showStatusBar' },
  clearOnExit: { category: 'privacy', field: 'clearOnExit' },
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
    defaultZoom: settings.appearance?.defaultZoom ?? defaultPreferences.defaultZoom,
    zoomMin: settings.appearance?.zoomMin ?? defaultPreferences.zoomMin,
    zoomMax: settings.appearance?.zoomMax ?? defaultPreferences.zoomMax,
    showBookmarksBar: settings.appearance?.showBookmarksBar ?? defaultPreferences.showBookmarksBar,
    showStatusBar: settings.appearance?.showStatusBar ?? defaultPreferences.showStatusBar,
    clearOnExit: settings.privacy?.clearOnExit ?? defaultPreferences.clearOnExit,
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

    // Sync each changed category to main process
    try {
      for (const [category, values] of Object.entries(categoryUpdates)) {
        await window.electron.settings.set(category, values)
      }
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
