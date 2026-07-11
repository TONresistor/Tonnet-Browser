/**
 * Application settings management.
 * Load, save, and access user preferences.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { VersionedJsonRepository } from '../persistence/versioned-json-repository'
import { UnsupportedSchemaVersionError } from '../persistence/schema-version'
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
const SETTINGS_SCHEMA_VERSION = 1

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

// Default settings, derived from the Zod schema's field-level `.default()`s
// (single source of truth). Only the platform-specific download path is
// applied on top, since the schema cannot know it.
export function getDefaultSettings(): AppSettings {
  const defaults = AppSettingsSchema.parse({})
  defaults.storage.downloadPath = getDefaultStoragePath()
  return defaults
}

// In-memory cache
let settingsCache: AppSettings | null = null
let settingsRepository: VersionedJsonRepository<AppSettings> | null = null
let settingsMutationChain: Promise<void> = Promise.resolve()

function getRepository(): VersionedJsonRepository<AppSettings> {
  if (!settingsRepository) {
    settingsRepository = new VersionedJsonRepository({
      filePath: getSettingsFile(),
      version: SETTINGS_SCHEMA_VERSION,
      schema: AppSettingsSchema,
      defaults: getDefaultSettings,
      migrate: (raw) => migrateAll(raw).data,
      mode: 0o600,
      corruption: 'reset-with-backup',
      onCorrupt: (error, backupPath) => log.error(`Corrupt settings quarantined at ${backupPath}: ${String(error)}`),
    })
  }
  return settingsRepository
}

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

// Migrate legacy theme names to current ones (pre-Zod; the schema still accepts
// the legacy literals, so rewriting here removes them from disk on next persist).
const LEGACY_THEME_MAP: Record<string, string> = {
  'midnight-blue': 'resistance-dog',
  'canard-yellow': 'utya-duck',
}
export function migrateTheme(raw: unknown): { migrated: boolean; data: unknown } {
  if (!raw || typeof raw !== 'object') return { migrated: false, data: raw }
  const obj = raw as Record<string, unknown>
  const appearance = obj.appearance as Record<string, unknown> | undefined
  const theme = appearance?.theme
  if (typeof theme === 'string' && LEGACY_THEME_MAP[theme]) {
    return {
      migrated: true,
      data: { ...obj, appearance: { ...appearance, theme: LEGACY_THEME_MAP[theme] } },
    }
  }
  return { migrated: false, data: raw }
}

function assertSettingsVersion(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && Number.isInteger(version) && version > SETTINGS_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version, SETTINGS_SCHEMA_VERSION, getSettingsFile())
  }
}

/** Run all pre-validation migrations in sequence, reporting if any changed the data. */
function migrateAll(raw: unknown): { migrated: boolean; data: unknown } {
  const r1 = migrateSettings(raw)
  const r2 = migrateNotificationStyle(r1.data)
  const r3 = migrateTheme(r2.data)
  return { migrated: r1.migrated || r2.migrated || r3.migrated, data: r3.data }
}

/** Persist during load without letting a transient write failure abort startup. */
function persistBestEffort(settings: AppSettings): void {
  void saveSettings(settings).catch(() => {
    /* saveSettings already logged; in-memory settings are still usable */
  })
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
    persistBestEffort(defaults)
    return defaults
  }

  try {
    const raw: unknown = JSON.parse(readFileSync(settingsFile, 'utf-8'))
    assertSettingsVersion(raw)

    const { migrated, data: parsed } = migrateAll(raw)
    if (migrated) {
      log.info('Migrated legacy settings to current schema')
    }

    // Use Zod to validate and apply defaults for missing fields
    const result = AppSettingsSchema.safeParse(parsed)
    if (!result.success) {
      log.warn(`Invalid settings file format: ${result.error.message}, using defaults`)
      settingsCache = defaults
      persistBestEffort(defaults)
      return defaults
    }

    settingsCache = result.data

    // Apply dynamic default for downloadPath if not set (in-memory only)
    if (!settingsCache.storage.downloadPath) {
      settingsCache.storage.downloadPath = getDefaultStoragePath()
    }

    // Persist once if any migration rewrote the data, so legacy keys leave disk
    if (migrated) {
      persistBestEffort(settingsCache)
    }

    return settingsCache
  } catch (error) {
    log.error(`Failed to load settings: ${String(error)}`)
    settingsCache = defaults
    return defaults
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await getRepository().save(settings)
    settingsCache = settings
  } catch (error) {
    log.error(`Failed to save settings: ${String(error)}`)
    throw error
  }
}

// Get a specific category
export function getSetting<K extends keyof AppSettings>(category: K): AppSettings[K] {
  const settings = loadSettings()
  return settings[category]
}

// Update a specific category
export async function setSetting<K extends keyof AppSettings>(
  category: K,
  values: Partial<AppSettings[K]>
): Promise<void> {
  const mutation = settingsMutationChain
    .catch(() => undefined)
    .then(async () => {
      const settings = loadSettings()
      const updated = { ...settings, [category]: { ...settings[category], ...values } }
      await saveSettings(updated)
    })
  settingsMutationChain = mutation
  await mutation
}

// Reset to defaults
export async function resetSettings(): Promise<void> {
  const mutation = settingsMutationChain.catch(() => undefined).then(() => saveSettings(getDefaultSettings()))
  settingsMutationChain = mutation
  await mutation
}

// Convenience getters for commonly used settings
export function getDownloadPath(): string {
  return getSetting('storage').downloadPath
}

export async function setDownloadPath(path: string): Promise<void> {
  await setSetting('storage', { downloadPath: path })
}
