/**
 * Application settings management.
 * Load, save, and access user preferences.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import type { ThemeType } from '../../shared/defaults'
import type { CustomTheme } from '../../shared/types'

// Settings interfaces
export interface GeneralSettings {
  homepage: string
  restoreTabs: boolean
}

export interface NetworkSettings {
  proxyPort: number
  storagePort: number
  autoConnect: boolean
  connectionTimeout: number
  syncCheckInterval: number
  anonymousMode: boolean
  circuitRotation: boolean
  rotateInterval: string
}

export interface StorageSettings {
  downloadPath: string
  pollingInterval: number
}

export type { ThemeType }

export interface AppearanceSettings {
  theme: ThemeType
  customThemes: CustomTheme[]
  defaultZoom: number
  zoomMin: number
  zoomMax: number
  showBookmarksBar: boolean
  showStatusBar: boolean
}

export interface PrivacySettings {
  clearOnExit: boolean
}

export interface AdvancedSettings {
  proxyVerbosity: number
  storageVerbosity: number
  syncTestDomain: string
}

export interface AppSettings {
  general: GeneralSettings
  network: NetworkSettings
  storage: StorageSettings
  appearance: AppearanceSettings
  privacy: PrivacySettings
  advanced: AdvancedSettings
}

// File paths
const getSettingsDir = () => join(app.getPath('userData'))
const getSettingsFile = () => join(getSettingsDir(), 'app-settings.json')
const getDefaultStoragePath = () => join(app.getPath('userData'), 'storage')

// Security: Validate parsed settings structure
function isValidSettingsObject(obj: unknown): obj is Partial<AppSettings> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false
  }

  const settings = obj as Record<string, unknown>
  const categories = ['general', 'network', 'storage', 'appearance', 'privacy', 'advanced']

  for (const key of Object.keys(settings)) {
    // Only allow known categories
    if (!categories.includes(key)) {
      console.warn(`[Settings] Unknown category: ${key}`)
      continue
    }
    // Each category must be an object
    if (typeof settings[key] !== 'object' || settings[key] === null || Array.isArray(settings[key])) {
      console.warn(`[Settings] Invalid category format: ${key}`)
      return false
    }
  }

  // Validate specific field types if present
  const network = settings.network as Record<string, unknown> | undefined
  if (network) {
    if (network.proxyPort !== undefined && typeof network.proxyPort !== 'number') return false
    if (network.storagePort !== undefined && typeof network.storagePort !== 'number') return false
    if (network.autoConnect !== undefined && typeof network.autoConnect !== 'boolean') return false
    if (network.anonymousMode !== undefined && typeof network.anonymousMode !== 'boolean') return false
    if (network.circuitRotation !== undefined && typeof network.circuitRotation !== 'boolean') return false
    if (network.rotateInterval !== undefined && typeof network.rotateInterval !== 'string') return false
  }

  const privacy = settings.privacy as Record<string, unknown> | undefined
  if (privacy) {
    if (privacy.clearOnExit !== undefined && typeof privacy.clearOnExit !== 'boolean') return false
  }

  const appearance = settings.appearance as Record<string, unknown> | undefined
  if (appearance) {
    // Accept built-in themes, old names, and custom theme IDs (custom:xxx)
    if (appearance.theme !== undefined) {
      const theme = appearance.theme as string
      const isBuiltIn = ['resistance-dog', 'utya-duck', 'midnight-blue', 'canard-yellow'].includes(theme)
      const isCustom = typeof theme === 'string' && theme.startsWith('custom:')
      if (!isBuiltIn && !isCustom) return false
    }
    if (appearance.defaultZoom !== undefined && typeof appearance.defaultZoom !== 'number') return false
    // customThemes must be an array if present
    if (appearance.customThemes !== undefined && !Array.isArray(appearance.customThemes)) return false
  }

  return true
}

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
      autoConnect: DEFAULT_SETTINGS.autoConnect,
      connectionTimeout: DEFAULT_SETTINGS.connectionTimeout,
      syncCheckInterval: DEFAULT_SETTINGS.syncCheckInterval,
      anonymousMode: DEFAULT_SETTINGS.anonymousMode,
      circuitRotation: DEFAULT_SETTINGS.circuitRotation,
      rotateInterval: DEFAULT_SETTINGS.rotateInterval,
    },
    storage: {
      downloadPath: getDefaultStoragePath(), // Platform-specific override
      pollingInterval: DEFAULT_SETTINGS.pollingInterval,
    },
    appearance: {
      theme: DEFAULT_SETTINGS.theme,
      customThemes: DEFAULT_SETTINGS.customThemes,
      defaultZoom: DEFAULT_SETTINGS.defaultZoom,
      zoomMin: DEFAULT_SETTINGS.zoomMin,
      zoomMax: DEFAULT_SETTINGS.zoomMax,
      showBookmarksBar: DEFAULT_SETTINGS.showBookmarksBar,
      showStatusBar: DEFAULT_SETTINGS.showStatusBar,
    },
    privacy: {
      clearOnExit: DEFAULT_SETTINGS.clearOnExit,
    },
    advanced: {
      proxyVerbosity: DEFAULT_SETTINGS.proxyVerbosity,
      storageVerbosity: DEFAULT_SETTINGS.storageVerbosity,
      syncTestDomain: DEFAULT_SETTINGS.syncTestDomain,
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

    // Security: Validate parsed data structure
    if (!isValidSettingsObject(parsed)) {
      console.warn('[Settings] Invalid settings file format, using defaults')
      settingsCache = defaults
      saveSettings(defaults)
      return defaults
    }

    const loaded = parsed

    // Merge with defaults to ensure all fields exist
    settingsCache = {
      general: { ...defaults.general, ...loaded.general },
      network: { ...defaults.network, ...loaded.network },
      storage: { ...defaults.storage, ...loaded.storage },
      appearance: { ...defaults.appearance, ...loaded.appearance },
      privacy: { ...defaults.privacy, ...loaded.privacy },
      advanced: { ...defaults.advanced, ...loaded.advanced },
    }

    // Migrate old theme names to new ones
    if (settingsCache.appearance.theme === 'midnight-blue' as ThemeType) {
      settingsCache.appearance.theme = 'resistance-dog'
      saveSettings(settingsCache)
    } else if (settingsCache.appearance.theme === 'canard-yellow' as ThemeType) {
      settingsCache.appearance.theme = 'utya-duck'
      saveSettings(settingsCache)
    }

    return settingsCache
  } catch (error) {
    console.error('[Settings] Failed to load settings:', error)
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
    console.error('[Settings] Failed to save settings:', error)
  }
}

// Get a specific category
export function getSetting<K extends keyof AppSettings>(category: K): AppSettings[K] {
  const settings = loadSettings()
  return settings[category]
}

// Update a specific category
export function setSetting<K extends keyof AppSettings>(
  category: K,
  values: Partial<AppSettings[K]>
): void {
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

export function getProxyPort(): number {
  return getSetting('network').proxyPort
}

export function getStoragePort(): number {
  return getSetting('network').storagePort
}
