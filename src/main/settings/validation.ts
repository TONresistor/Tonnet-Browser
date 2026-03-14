/**
 * Settings validation functions - extracted for testing without Electron dependencies
 */

import { z } from 'zod'
import type { AppSettings } from '../../shared/types'
import {
  AppSettingsSchema,
  GeneralSettingsPartialSchema,
  NetworkSettingsPartialSchema,
  StorageSettingsPartialSchema,
  AppearanceSettingsPartialSchema,
  PrivacySettingsPartialSchema,
  ContentFilteringSettingsPartialSchema,
  AdvancedSettingsPartialSchema,
} from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { createLogger } from '../../shared/logger'
const log = createLogger('settings')

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
 * Validate a full settings object using Zod.
 * Returns parsed (and defaulted) data on success, or an error message on failure.
 */
export function validateSettings(data: unknown): { valid: true; data: AppSettings } | { valid: false; error: string } {
  const result = AppSettingsSchema.safeParse(data)
  if (result.success) {
    return { valid: true, data: result.data }
  }
  return { valid: false, error: result.error.message }
}

/**
 * Validate values for a specific settings category using Zod (partial schema).
 * Used by the SETTINGS_SET IPC handler to validate incoming updates.
 */
export function validateCategoryValues(
  category: keyof AppSettings,
  values: unknown
): { valid: true; data: unknown } | { valid: false; error: string } {
  // Use partial schemas WITHOUT defaults so Zod only validates/strips provided fields.
  // This preserves the partial update semantics: only the supplied keys are returned.
  const schemas: Record<string, z.ZodSchema> = {
    general: GeneralSettingsPartialSchema,
    network: NetworkSettingsPartialSchema,
    storage: StorageSettingsPartialSchema,
    appearance: AppearanceSettingsPartialSchema,
    privacy: PrivacySettingsPartialSchema,
    contentFiltering: ContentFilteringSettingsPartialSchema,
    advanced: AdvancedSettingsPartialSchema,
  }
  const schema = schemas[category]
  if (!schema) {
    return { valid: false, error: `Unknown category: ${category}` }
  }
  const result = schema.safeParse(values)
  if (result.success) {
    return { valid: true, data: result.data }
  }
  return { valid: false, error: result.error.message }
}

/**
 * Security: Validate parsed settings structure (structural/type check only, no range checks).
 * Kept for backward compatibility with existing tests and callers.
 * For full validation with Zod, use validateSettings() instead.
 */
export function isValidSettingsObject(obj: unknown): obj is Partial<AppSettings> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false
  }

  const settings = obj as Record<string, unknown>
  const categories: readonly string[] = SETTINGS_CATEGORIES

  for (const key of Object.keys(settings)) {
    // Only warn for unknown categories, but allow them
    if (!categories.includes(key)) {
      log.warn(`Unknown category: ${key}`)
      continue
    }
    // Each known category must be an object
    if (typeof settings[key] !== 'object' || settings[key] === null || Array.isArray(settings[key])) {
      log.warn(`Invalid category format: ${key}`)
      return false
    }
  }

  // Validate specific field types and values if present
  const network = settings.network as Record<string, unknown> | undefined
  if (network) {
    if (network.proxyPort !== undefined) {
      if (typeof network.proxyPort !== 'number') return false
      if (network.proxyPort < 1024 || network.proxyPort > 65535) return false
    }
    if (network.storagePort !== undefined) {
      if (typeof network.storagePort !== 'number') return false
      if (network.storagePort < 1024 || network.storagePort > 65535) return false
    }
    if (network.autoConnect !== undefined && typeof network.autoConnect !== 'boolean') return false
    if (network.anonymousMode !== undefined && typeof network.anonymousMode !== 'boolean') return false
    if (network.circuitRotation !== undefined && typeof network.circuitRotation !== 'boolean') return false
    if (network.rotateInterval !== undefined) {
      if (typeof network.rotateInterval !== 'string') return false
      if (!/^\d+[smh]$/.test(network.rotateInterval)) return false
    }
  }

  const privacy = settings.privacy as Record<string, unknown> | undefined
  if (privacy) {
    if (privacy.clearOnExit !== undefined && typeof privacy.clearOnExit !== 'boolean') return false
    if (privacy.disableCache !== undefined && typeof privacy.disableCache !== 'boolean') return false
    if (privacy.firstPartyIsolation !== undefined && typeof privacy.firstPartyIsolation !== 'boolean') return false
    if (privacy.cookieAutoDelete !== undefined && typeof privacy.cookieAutoDelete !== 'boolean') return false
    if (privacy.cookieAutoDeleteMinutes !== undefined && typeof privacy.cookieAutoDeleteMinutes !== 'number')
      return false
  }

  const appearance = settings.appearance as Record<string, unknown> | undefined
  if (appearance) {
    // Accept built-in themes, old legacy names, and custom theme IDs (custom:xxx)
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

/**
 * Get default settings without Electron dependencies.
 * Uses fixed paths suitable for testing.
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
    },
    advanced: {
      proxyVerbosity: d.proxyVerbosity,
      storageVerbosity: d.storageVerbosity,
      syncTestDomain: d.syncTestDomain,
    },
  }
}
