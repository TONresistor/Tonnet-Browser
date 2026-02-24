/**
 * Settings validation functions - extracted for testing without Electron dependencies
 */

import type { AppSettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'

/** Valid settings category names, derived from the AppSettings type */
export const SETTINGS_CATEGORIES: ReadonlyArray<keyof AppSettings> = [
  'general',
  'network',
  'storage',
  'appearance',
  'privacy',
  'contentFiltering',
  'advanced',
]

/**
 * Security: Validate parsed settings structure
 * Ensures the settings object has valid format and types
 */
export function isValidSettingsObject(obj: unknown): obj is Partial<AppSettings> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false
  }

  const settings = obj as Record<string, unknown>
  const categories: readonly string[] = SETTINGS_CATEGORIES

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
    if (appearance.language !== undefined && typeof appearance.language !== 'string') return false
    if (appearance.defaultZoom !== undefined && typeof appearance.defaultZoom !== 'number') return false
  }

  return true
}

/**
 * Get default settings without Electron dependencies
 * Uses fixed paths suitable for testing
 */
export function getDefaultSettingsBase(): AppSettings {
  const d = DEFAULT_SETTINGS
  return {
    general: {
      homepage: d.homepage,
      restoreTabs: d.restoreTabs,
    },
    network: {
      proxyPort: d.proxyPort,
      storagePort: d.storagePort,
      autoConnect: d.autoConnect,
      connectionTimeout: d.connectionTimeout,
      syncCheckInterval: d.syncCheckInterval,
      anonymousMode: d.anonymousMode,
      circuitRotation: d.circuitRotation,
      rotateInterval: d.rotateInterval,
    },
    storage: {
      downloadPath: '/tmp/tonnet-storage',
      pollingInterval: d.pollingInterval,
    },
    appearance: {
      theme: d.theme,
      customThemes: [...d.customThemes],
      language: d.language,
      defaultZoom: d.defaultZoom,
      zoomMin: d.zoomMin,
      zoomMax: d.zoomMax,
      showBookmarksBar: d.showBookmarksBar,
      showStatusBar: d.showStatusBar,
      tabOrientation: d.tabOrientation,
      sidebarWidth: d.sidebarWidth,
    },
    privacy: {
      clearOnExit: d.clearOnExit,
      disableCache: d.disableCache,
      firstPartyIsolation: d.firstPartyIsolation,
      cookieAutoDelete: d.cookieAutoDelete,
      cookieAutoDeleteMinutes: d.cookieAutoDeleteMinutes,
      historyMode: d.historyMode,
      historyMaxEntries: d.historyMaxEntries,
    },
    contentFiltering: {
      enabled: d.contentFiltering.enabled,
      blockAds: d.contentFiltering.blockAds,
      blockTrackers: d.contentFiltering.blockTrackers,
      blockMiners: d.contentFiltering.blockMiners,
      blockMalware: d.contentFiltering.blockMalware,
      blockAnnoyances: d.contentFiltering.blockAnnoyances,
      whitelistedDomains: [...d.contentFiltering.whitelistedDomains],
      showBlockCount: d.contentFiltering.showBlockCount,
    },
    advanced: {
      proxyVerbosity: d.proxyVerbosity,
      storageVerbosity: d.storageVerbosity,
      syncTestDomain: d.syncTestDomain,
    },
  }
}
