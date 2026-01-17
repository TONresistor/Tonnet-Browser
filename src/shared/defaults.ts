/**
 * Default settings values.
 * Shared between main and renderer processes.
 */

import type { CustomTheme } from './types'

export type BuiltInTheme = 'resistance-dog' | 'utya-duck'
export type ThemeType = BuiltInTheme | `custom:${string}`

/**
 * Default values for all settings.
 * Main process may override downloadPath with platform-specific path.
 */
export const DEFAULT_SETTINGS = {
  // General
  homepage: 'ton://start',
  restoreTabs: false,

  // Network
  proxyPort: 8080,
  storagePort: 5555,
  autoConnect: false,
  connectionTimeout: 30,
  syncCheckInterval: 3000,
  anonymousMode: false,
  circuitRotation: true,
  rotateInterval: '10m',

  // Storage
  downloadPath: '', // Main process will set actual path
  pollingInterval: 2000,

  // Appearance
  theme: 'resistance-dog' as ThemeType,
  customThemes: [] as CustomTheme[],
  defaultZoom: 100,
  zoomMin: 30,
  zoomMax: 300,
  showBookmarksBar: true,
  showStatusBar: true,

  // Privacy
  clearOnExit: true, // Privacy-first: clear data on exit by default
  disableCache: false, // Disable HTTP cache for maximum privacy (slower)
  firstPartyIsolation: true, // Isolate cookies/localStorage per domain (Tier S)
  cookieAutoDelete: false, // Auto-delete cookies after inactivity (Tier A)
  cookieAutoDeleteMinutes: 30, // Minutes of inactivity before auto-delete
  historyMode: 'memory' as const, // History mode: 'memory' (RAM only) | 'persistent' (auto-encrypted disk)
  historyMaxEntries: 1000, // Maximum history entries

  // Advanced
  proxyVerbosity: 2,
  storageVerbosity: 2,
  syncTestDomain: 'tonnet-sync-check.ton',
} as const
