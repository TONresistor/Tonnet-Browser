/**
 * Application settings management.
 * Load, save, and access user preferences.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import type { ThemeType } from '../../shared/defaults'
import type {
  GeneralSettings,
  NetworkSettings,
  StorageSettings,
  AppearanceSettings,
  PrivacySettings,
  AdvancedSettings,
  AppSettings,
  ContentFilteringSettings,
} from '../../shared/types'
import { AppSettingsSchema } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('settings')
import { SETTINGS_CATEGORIES } from './validation'

// Re-export settings types for consumers that import from this module
export type {
  GeneralSettings,
  NetworkSettings,
  StorageSettings,
  AppearanceSettings,
  PrivacySettings,
  AdvancedSettings,
  AppSettings,
  ContentFilteringSettings,
  ThemeType,
}

// File paths
const getSettingsDir = () => join(app.getPath('userData'))
const getSettingsFile = () => join(getSettingsDir(), 'app-settings.json')
const getDefaultStoragePath = () => join(app.getPath('userData'), 'storage')

// Default settings (using shared defaults)
export function getDefaultSettings(): AppSettings {
  return {
    general: {
      homepage: DEFAULT_SETTINGS.homepage,
      restoreTabs: DEFAULT_SETTINGS.restoreTabs,
    },
    network: {
      proxyPort: DEFAULT_SETTINGS.proxyPort,
      storagePort: DEFAULT_SETTINGS.storagePort,
      wsPort: DEFAULT_SETTINGS.wsPort,
      autoConnect: DEFAULT_SETTINGS.autoConnect,
      connectionTimeout: DEFAULT_SETTINGS.connectionTimeout,
      syncCheckInterval: DEFAULT_SETTINGS.syncCheckInterval,
      anonymousMode: DEFAULT_SETTINGS.anonymousMode,
    },
    storage: {
      downloadPath: getDefaultStoragePath(), // Platform-specific override
      pollingInterval: DEFAULT_SETTINGS.pollingInterval,
    },
    appearance: {
      theme: DEFAULT_SETTINGS.theme,
      customThemes: DEFAULT_SETTINGS.customThemes,
      language: DEFAULT_SETTINGS.language,
      defaultZoom: DEFAULT_SETTINGS.defaultZoom,
      zoomMin: DEFAULT_SETTINGS.zoomMin,
      zoomMax: DEFAULT_SETTINGS.zoomMax,
      showBookmarksBar: DEFAULT_SETTINGS.showBookmarksBar,
      showStatusBar: DEFAULT_SETTINGS.showStatusBar,
      tabOrientation: DEFAULT_SETTINGS.tabOrientation,
      sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
    },
    privacy: {
      clearOnExit: DEFAULT_SETTINGS.clearOnExit,
      disableCache: DEFAULT_SETTINGS.disableCache,
      firstPartyIsolation: DEFAULT_SETTINGS.firstPartyIsolation,
      cookieAutoDelete: DEFAULT_SETTINGS.cookieAutoDelete,
      cookieAutoDeleteMinutes: DEFAULT_SETTINGS.cookieAutoDeleteMinutes,
      historyMode: DEFAULT_SETTINGS.historyMode,
      historyMaxEntries: DEFAULT_SETTINGS.historyMaxEntries,
    },
    contentFiltering: {
      enabled: DEFAULT_SETTINGS.contentFiltering.enabled,
      blockAds: DEFAULT_SETTINGS.contentFiltering.blockAds,
      blockTrackers: DEFAULT_SETTINGS.contentFiltering.blockTrackers,
      blockMiners: DEFAULT_SETTINGS.contentFiltering.blockMiners,
      blockMalware: DEFAULT_SETTINGS.contentFiltering.blockMalware,
      blockAnnoyances: DEFAULT_SETTINGS.contentFiltering.blockAnnoyances,
      whitelistedDomains: DEFAULT_SETTINGS.contentFiltering.whitelistedDomains,
    },
    advanced: {
      proxyVerbosity: DEFAULT_SETTINGS.proxyVerbosity,
      storageVerbosity: DEFAULT_SETTINGS.storageVerbosity,
      syncTestDomain: DEFAULT_SETTINGS.syncTestDomain,
    },
    wallet: {
      paymentMode: DEFAULT_SETTINGS.wallet.paymentMode,
      notificationStyle: DEFAULT_SETTINGS.wallet.notificationStyle,
      limits: { ...DEFAULT_SETTINGS.wallet.limits },
      sitePolicies: [...DEFAULT_SETTINGS.wallet.sitePolicies],
      autoPayDomains: [...DEFAULT_SETTINGS.wallet.autoPayDomains],
    },
    bridge: {
      permissions: [],
      defaultPolicy: 'ask',
    },
  }
}

// In-memory cache
let settingsCache: AppSettings | null = null

// Load settings from disk
export function loadSettings(): AppSettings {
  if (settingsCache) {
    return settingsCache
  }

  const settingsFile = getSettingsFile()
  const defaults = getDefaultSettings()

  if (!existsSync(settingsFile)) {
    settingsCache = defaults
    saveSettings(defaults)
    return defaults
  }

  try {
    const data = readFileSync(settingsFile, 'utf-8')
    const parsed: unknown = JSON.parse(data)

    // Use Zod to validate and apply defaults for missing fields
    const result = AppSettingsSchema.safeParse(parsed)

    if (!result.success) {
      log.warn(`Invalid settings file format: ${result.error.message}, using defaults`)
      settingsCache = defaults
      saveSettings(defaults)
      return defaults
    }

    settingsCache = result.data

    // Apply dynamic default for downloadPath if not set
    if (!settingsCache.storage.downloadPath) {
      settingsCache.storage.downloadPath = getDefaultStoragePath()
    }

    // Migrate old theme names to new ones
    if (settingsCache.appearance.theme === ('midnight-blue' as ThemeType)) {
      settingsCache.appearance.theme = 'resistance-dog'
      saveSettings(settingsCache)
    } else if (settingsCache.appearance.theme === ('canard-yellow' as ThemeType)) {
      settingsCache.appearance.theme = 'utya-duck'
      saveSettings(settingsCache)
    }

    return settingsCache
  } catch (error) {
    log.error(`Failed to load settings: ${String(error)}`)
    settingsCache = defaults
    return defaults
  }
}

// Save settings to disk (atomic write)
export function saveSettings(settings: AppSettings): void {
  const settingsFile = getSettingsFile()
  const tempFile = settingsFile + '.tmp'
  const dir = getSettingsDir()

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  try {
    // Atomic write: write to temp file, then rename
    writeFileSync(tempFile, JSON.stringify(settings, null, 2))
    renameSync(tempFile, settingsFile)
    settingsCache = settings
  } catch (error) {
    log.error(`Failed to save settings: ${String(error)}`)
    try {
      unlinkSync(tempFile)
    } catch {
      /* ignore cleanup failure */
    }
  }
}

// Get a specific category
export function getSetting<K extends keyof AppSettings>(category: K): AppSettings[K] {
  const settings = loadSettings()
  return settings[category]
}

// Update a specific category
export function setSetting<K extends keyof AppSettings>(category: K, values: Partial<AppSettings[K]>): void {
  const settings = loadSettings()
  settings[category] = { ...settings[category], ...values }
  saveSettings(settings)
}

// Reset to defaults
export function resetSettings(): void {
  const defaults = getDefaultSettings()
  saveSettings(defaults)
}

// Convenience getters for commonly used settings
export function getDownloadPath(): string {
  return getSetting('storage').downloadPath
}

export function setDownloadPath(path: string): void {
  setSetting('storage', { downloadPath: path })
}
