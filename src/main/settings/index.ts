/**
 * Application settings management.
 * Load, save, and access user preferences.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { writeSecureJsonAtomic } from '../utils/secure-fs'
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
let _basePath: string | undefined
export function setBasePath(path: string): void {
  _basePath = path
}
const getSettingsDir = () => _basePath ?? join(app.getPath('userData'))
const getSettingsFile = () => join(getSettingsDir(), 'app-settings.json')
const getDefaultStoragePath = () => join(_basePath ?? app.getPath('userData'), 'storage')

// Default settings (using shared defaults)
export function getDefaultSettings(): AppSettings {
  return {
    general: {
      homepage: DEFAULT_SETTINGS.homepage,
      resolveEth: DEFAULT_SETTINGS.resolveEth,
      ethRpc: DEFAULT_SETTINGS.ethRpc,
      resolveSol: DEFAULT_SETTINGS.resolveSol,
      solRpc: DEFAULT_SETTINGS.solRpc,
    },
    network: {
      proxyPort: DEFAULT_SETTINGS.proxyPort,
      storagePort: DEFAULT_SETTINGS.storagePort,
      wsPort: DEFAULT_SETTINGS.wsPort,
      autoConnect: DEFAULT_SETTINGS.autoConnect,
      connectionTimeout: DEFAULT_SETTINGS.connectionTimeout,
      syncCheckInterval: DEFAULT_SETTINGS.syncCheckInterval,
      anonymousMode: DEFAULT_SETTINGS.anonymousMode,
      tunnelMode: DEFAULT_SETTINGS.tunnelMode,
    },
    storage: {
      downloadPath: getDefaultStoragePath(), // Platform-specific override
      pollingInterval: DEFAULT_SETTINGS.pollingInterval,
      seedingEnabled: DEFAULT_SETTINGS.seedingEnabled,
      downloadSpeedLimit: DEFAULT_SETTINGS.downloadSpeedLimit,
      uploadSpeedLimit: DEFAULT_SETTINGS.uploadSpeedLimit,
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
      autoLockMinutes: DEFAULT_SETTINGS.wallet.autoLockMinutes,
    },
    bridge: {
      permissions: [],
      defaultPolicy: 'ask',
    },
    cocoon: {
      autostart: DEFAULT_SETTINGS.cocoon.autostart,
    },
  }
}

// In-memory cache
let settingsCache: AppSettings | null = null

/**
 * Migrate legacy notificationStyle values (banner/modal/toast/panel) to the
 * two-value set introduced in v1.7: 'popup' | 'addressbar'.
 * Map: banner → addressbar, modal/toast/panel → popup.
 * Already-valid values are left unchanged (idempotent).
 */
export function migrateNotificationStyle(raw: unknown): { migrated: boolean; data: unknown } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { migrated: false, data: raw }
  }

  const obj = raw as Record<string, unknown>
  const wallet = obj['wallet']

  if (typeof wallet !== 'object' || wallet === null || Array.isArray(wallet)) {
    return { migrated: false, data: raw }
  }

  const w = wallet as Record<string, unknown>
  const current = w['notificationStyle']
  const legacyMap: Record<string, string> = {
    banner: 'addressbar',
    modal: 'popup',
    toast: 'popup',
    panel: 'popup',
  }

  if (typeof current !== 'string' || !(current in legacyMap)) {
    return { migrated: false, data: raw }
  }

  return {
    migrated: true,
    data: { ...obj, wallet: { ...w, notificationStyle: legacyMap[current] } },
  }
}

/**
 * Migrate v1.5.3 network settings to v1.6.0 shape.
 *
 * v1.5.3 had `circuitRotation: boolean` and `rotateInterval: string` under `network`.
 * v1.6.0 replaces them with `tunnelMode: 'standard' | 'maximum'` (hop count, not rotation
 * frequency). Since the two concepts are not directly equivalent and `anonymousMode` already
 * controls whether tunnelling is active at all, both old field combinations map to the
 * conservative default `'standard'` (2 hops). If `tunnelMode` is already present the object
 * is returned unchanged (idempotent).
 *
 * @param raw - The parsed-but-unvalidated JSON object from disk.
 * @returns A new object with legacy keys removed from `network` and `tunnelMode` populated,
 *          or the original object if no migration was needed.
 */
export function migrateSettings(raw: unknown): { migrated: boolean; data: unknown } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { migrated: false, data: raw }
  }

  const obj = raw as Record<string, unknown>
  const network = obj['network']

  if (typeof network !== 'object' || network === null || Array.isArray(network)) {
    return { migrated: false, data: raw }
  }

  const net = network as Record<string, unknown>
  const hasLegacy = 'circuitRotation' in net || 'rotateInterval' in net
  const hasCurrent = 'tunnelMode' in net

  if (!hasLegacy) {
    return { migrated: false, data: raw }
  }

  // Strip legacy keys and inject tunnelMode if absent
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { circuitRotation: _cr, rotateInterval: _ri, ...restNet } = net
  const migratedNet: Record<string, unknown> = {
    ...restNet,
    ...(hasCurrent ? {} : { tunnelMode: 'standard' }),
  }

  return {
    migrated: true,
    data: { ...obj, network: migratedNet },
  }
}

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
    const raw: unknown = JSON.parse(data)

    // Migrate legacy v1.5.3 fields before Zod validation
    const { migrated: m1, data: d1 } = migrateSettings(raw)
    if (m1) {
      log.info('Migrated legacy network settings (circuitRotation/rotateInterval → tunnelMode)')
    }
    const { migrated: m2, data: parsed } = migrateNotificationStyle(d1)
    if (m2) {
      log.info('Migrated legacy notificationStyle')
    }
    const migrated = m1 || m2

    // Use Zod to validate and apply defaults for missing fields
    const result = AppSettingsSchema.safeParse(parsed)

    if (!result.success) {
      log.warn(`Invalid settings file format: ${result.error.message}, using defaults`)
      settingsCache = defaults
      saveSettings(defaults)
      return defaults
    }

    settingsCache = result.data

    // Persist migrated settings immediately so legacy keys are removed from disk
    if (migrated) {
      saveSettings(settingsCache)
    }

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

export function saveSettings(settings: AppSettings): void {
  try {
    writeSecureJsonAtomic(getSettingsFile(), settings, 2)
    settingsCache = settings
  } catch (error) {
    log.error(`Failed to save settings: ${String(error)}`)
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
