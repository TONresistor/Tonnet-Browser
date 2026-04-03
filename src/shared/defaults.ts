/**
 * Default settings values.
 * Shared between main and renderer processes.
 */

import type { CustomTheme, SitePolicy } from './types'

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
  wsPort: 8081,
  autoConnect: false,
  connectionTimeout: 30,
  syncCheckInterval: 3000,
  anonymousMode: false,

  // Storage
  downloadPath: '', // Main process will set actual path
  pollingInterval: 2000,

  // Appearance
  theme: 'resistance-dog' as ThemeType,
  customThemes: [] as CustomTheme[],
  language: 'en',
  defaultZoom: 100,
  zoomMin: 30,
  zoomMax: 300,
  showBookmarksBar: true,
  showStatusBar: true,
  tabOrientation: 'horizontal' as 'horizontal' | 'vertical',
  sidebarWidth: 240, // Default sidebar width in pixels

  // Privacy
  clearOnExit: true, // Privacy-first: clear data on exit by default
  disableCache: false, // Disable HTTP cache for maximum privacy (slower)
  firstPartyIsolation: true, // Isolate cookies/localStorage per domain (Tier S)
  cookieAutoDelete: false, // Auto-delete cookies after inactivity (Tier A)
  cookieAutoDeleteMinutes: 30, // Minutes of inactivity before auto-delete
  historyMode: 'memory' as const, // History mode: 'memory' (RAM only) | 'persistent' (auto-encrypted disk)
  historyMaxEntries: 1000, // Maximum history entries

  // Content Filtering
  contentFiltering: {
    enabled: true, // Master toggle
    blockAds: true,
    blockTrackers: true,
    blockMiners: true,
    blockMalware: true,
    blockAnnoyances: true,
    whitelistedDomains: [] as string[], // Bypass filter for these domains
  },

  // Advanced
  proxyVerbosity: 2,
  storageVerbosity: 2,
  syncTestDomain: 'tonnet-sync-check.ton',

  // Wallet
  wallet: {
    paymentMode: 'manual' as const,
    notificationStyle: 'banner' as const,
    limits: {
      perRequest: '0',
      perDay: '0',
      perSitePerMonth: '0',
    },
    sitePolicies: [] as SitePolicy[],
    autoPayDomains: [] as string[],
    autoLockMinutes: 5,
  },
} as const
