/**
 * Settings validation functions - extracted for testing without Electron dependencies
 */

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
}

export interface StorageSettings {
  downloadPath: string
  pollingInterval: number
}

export interface AppearanceSettings {
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

/**
 * Security: Validate parsed settings structure
 * Ensures the settings object has valid format and types
 */
export function isValidSettingsObject(obj: unknown): obj is Partial<AppSettings> {
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
  }

  const privacy = settings.privacy as Record<string, unknown> | undefined
  if (privacy) {
    if (privacy.clearOnExit !== undefined && typeof privacy.clearOnExit !== 'boolean') return false
  }

  const appearance = settings.appearance as Record<string, unknown> | undefined
  if (appearance) {
    if (appearance.defaultZoom !== undefined && typeof appearance.defaultZoom !== 'number') return false
  }

  return true
}

/**
 * Get default settings without Electron dependencies
 * Uses fixed paths suitable for testing
 */
export function getDefaultSettingsBase(): AppSettings {
  return {
    general: {
      homepage: 'ton://start',
      restoreTabs: false,
    },
    network: {
      proxyPort: 8080,
      storagePort: 5555,
      autoConnect: false,
      connectionTimeout: 30,
      syncCheckInterval: 3000,
    },
    storage: {
      downloadPath: '/tmp/tonnet-storage',
      pollingInterval: 2000,
    },
    appearance: {
      defaultZoom: 100,
      zoomMin: 30,
      zoomMax: 300,
      showBookmarksBar: true,
      showStatusBar: true,
    },
    privacy: {
      clearOnExit: true,
    },
    advanced: {
      proxyVerbosity: 2,
      storageVerbosity: 2,
      syncTestDomain: 'tonnet-sync-check.ton',
    },
  }
}
