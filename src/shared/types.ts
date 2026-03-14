/**
 * Shared types.
 * Used by both main and renderer processes.
 */

import { z } from 'zod'

export interface Tab {
  id: string
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  createdAt: number
}

export interface ProxyStatus {
  connected: boolean
  port: number
  error?: string
}

export interface StorageBag {
  id: string
  name: string
  size: number
  downloaded: number
  uploadSpeed: number
  downloadSpeed: number
  peers: number
  filesCount: number
  status: 'downloading' | 'seeding' | 'paused' | 'error'
}

export interface BagDetails {
  bag_id: string
  description: string
  files: Array<{ name: string; size: number }>
  peers: Array<{ addr: string; download_speed: number; upload_speed: number }>
  merkle_hash: string
  piece_size: number
  path: string
  downloaded: number
  size: number
  active: boolean
  seeding: boolean
}

// --- Zod Schemas ---

export const GeneralSettingsSchema = z.object({
  homepage: z.string().default('ton://start'),
  restoreTabs: z.boolean().default(false),
})

export const NetworkSettingsSchema = z.object({
  proxyPort: z.number().int().min(1024).max(65535).default(8080),
  storagePort: z.number().int().min(1024).max(65535).default(5555),
  autoConnect: z.boolean().default(false),
  connectionTimeout: z.number().min(5).max(120).default(30),
  syncCheckInterval: z.number().min(500).max(60000).default(3000),
  anonymousMode: z.boolean().default(false),
  circuitRotation: z.boolean().default(true),
  rotateInterval: z
    .string()
    .regex(/^\d+[smh]$/)
    .default('10m'),
})

export const StorageSettingsSchema = z.object({
  downloadPath: z.string().default(''),
  pollingInterval: z.number().min(500).max(30000).default(2000),
})

// Theme: built-in names OR custom:* prefix
const BuiltInThemeSchema = z.enum(['resistance-dog', 'utya-duck'])
const LegacyThemeSchema = z.enum(['midnight-blue', 'canard-yellow'])
const CustomThemeIdSchema = z.string().startsWith('custom:')
export const ThemeTypeSchema = z.union([BuiltInThemeSchema, LegacyThemeSchema, CustomThemeIdSchema])

export const ThemeColorsSchema = z.object({
  background: z.string(),
  backgroundSecondary: z.string(),
  foreground: z.string(),
  card: z.string(),
  cardForeground: z.string(),
  primary: z.string(),
  primaryForeground: z.string(),
  secondary: z.string(),
  secondaryForeground: z.string(),
  accent: z.string(),
  accentForeground: z.string(),
  muted: z.string(),
  mutedForeground: z.string(),
  destructive: z.string(),
  destructiveForeground: z.string(),
  success: z.string(),
  successForeground: z.string(),
  warning: z.string(),
  warningForeground: z.string(),
  info: z.string(),
  infoForeground: z.string(),
  border: z.string(),
  input: z.string(),
  ring: z.string(),
})

export const CustomThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  colors: ThemeColorsSchema,
  isDark: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const AppearanceSettingsSchema = z.object({
  theme: ThemeTypeSchema.default('resistance-dog'),
  customThemes: z.array(CustomThemeSchema).default([]),
  language: z.string().default('en'),
  defaultZoom: z.number().min(25).max(500).default(100),
  zoomMin: z.number().min(10).max(100).default(30),
  zoomMax: z.number().min(100).max(500).default(300),
  showBookmarksBar: z.boolean().default(true),
  showStatusBar: z.boolean().default(true),
  tabOrientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  sidebarWidth: z.number().min(64).max(400).default(240),
})

export const PrivacySettingsSchema = z.object({
  clearOnExit: z.boolean().default(true),
  disableCache: z.boolean().default(false),
  firstPartyIsolation: z.boolean().default(true),
  cookieAutoDelete: z.boolean().default(false),
  cookieAutoDeleteMinutes: z.number().min(1).max(1440).default(30),
  historyMode: z.enum(['memory', 'persistent']).default('memory'),
  historyMaxEntries: z.number().min(100).max(100000).default(1000),
})

export const ContentFilteringSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  blockAds: z.boolean().default(true),
  blockTrackers: z.boolean().default(true),
  blockMiners: z.boolean().default(true),
  blockMalware: z.boolean().default(true),
  blockAnnoyances: z.boolean().default(true),
  whitelistedDomains: z.array(z.string()).default([]),
})

export const AdvancedSettingsSchema = z.object({
  proxyVerbosity: z.number().min(0).max(5).default(2),
  storageVerbosity: z.number().min(0).max(5).default(2),
  syncTestDomain: z.string().default('tonnet-sync-check.ton'),
})

/**
 * Helper that makes a category schema optional (absent key = use all defaults).
 * In Zod v4, `.default({})` on a nested object does not apply inner field defaults,
 * so we use `.optional().transform()` to correctly fill all field-level defaults.
 */
function withCategoryDefaults<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.optional().transform((v) => schema.parse(v ?? {}))
}

export const AppSettingsSchema = z.object({
  general: withCategoryDefaults(GeneralSettingsSchema),
  network: withCategoryDefaults(NetworkSettingsSchema),
  storage: withCategoryDefaults(StorageSettingsSchema),
  appearance: withCategoryDefaults(AppearanceSettingsSchema),
  privacy: withCategoryDefaults(PrivacySettingsSchema),
  contentFiltering: withCategoryDefaults(ContentFilteringSettingsSchema),
  advanced: withCategoryDefaults(AdvancedSettingsSchema),
})

// Partial validation schemas (no defaults) — used to validate SETTINGS_SET updates.
// These validate types/constraints without filling in missing fields with defaults.
export const GeneralSettingsPartialSchema = z
  .object({
    homepage: z.string(),
    restoreTabs: z.boolean(),
  })
  .partial()

export const NetworkSettingsPartialSchema = z
  .object({
    proxyPort: z.number().int().min(1024).max(65535),
    storagePort: z.number().int().min(1024).max(65535),
    autoConnect: z.boolean(),
    connectionTimeout: z.number().min(5).max(120),
    syncCheckInterval: z.number().min(500).max(60000),
    anonymousMode: z.boolean(),
    circuitRotation: z.boolean(),
    rotateInterval: z.string().regex(/^\d+[smh]$/),
  })
  .partial()

export const StorageSettingsPartialSchema = z
  .object({
    downloadPath: z.string(),
    pollingInterval: z.number().min(500).max(30000),
  })
  .partial()

export const AppearanceSettingsPartialSchema = z
  .object({
    theme: ThemeTypeSchema,
    customThemes: z.array(CustomThemeSchema),
    language: z.string(),
    defaultZoom: z.number().min(25).max(500),
    zoomMin: z.number().min(10).max(100),
    zoomMax: z.number().min(100).max(500),
    showBookmarksBar: z.boolean(),
    showStatusBar: z.boolean(),
    tabOrientation: z.enum(['horizontal', 'vertical']),
    sidebarWidth: z.number().min(64).max(400),
  })
  .partial()

export const PrivacySettingsPartialSchema = z
  .object({
    clearOnExit: z.boolean(),
    disableCache: z.boolean(),
    firstPartyIsolation: z.boolean(),
    cookieAutoDelete: z.boolean(),
    cookieAutoDeleteMinutes: z.number().min(1).max(1440),
    historyMode: z.enum(['memory', 'persistent']),
    historyMaxEntries: z.number().min(100).max(100000),
  })
  .partial()

export const ContentFilteringSettingsPartialSchema = z
  .object({
    enabled: z.boolean(),
    blockAds: z.boolean(),
    blockTrackers: z.boolean(),
    blockMiners: z.boolean(),
    blockMalware: z.boolean(),
    blockAnnoyances: z.boolean(),
    whitelistedDomains: z.array(z.string()),
  })
  .partial()

export const AdvancedSettingsPartialSchema = z
  .object({
    proxyVerbosity: z.number().min(0).max(5),
    storageVerbosity: z.number().min(0).max(5),
    syncTestDomain: z.string(),
  })
  .partial()

// Derived TypeScript types from Zod schemas
export type ThemeColors = z.infer<typeof ThemeColorsSchema>
export type CustomTheme = z.infer<typeof CustomThemeSchema>
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>
export type NetworkSettings = z.infer<typeof NetworkSettingsSchema>
export type StorageSettings = z.infer<typeof StorageSettingsSchema>
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>
export type ContentFilteringSettings = z.infer<typeof ContentFilteringSettingsSchema>
export type AdvancedSettings = z.infer<typeof AdvancedSettingsSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>

// Re-export ThemeType from defaults for backward compatibility
export type { ThemeType, BuiltInTheme } from './defaults'

export interface ContentFilterStats {
  totalBlocked: number
  totalAllowed: number
  blockedByCategory: {
    ads: number
    trackers: number
    miners: number
    malware: number
    annoyances: number
  }
  sessionStarted: number
}

export interface ContentFilterEvent {
  url: string
  resourceType: string
  category: 'ads' | 'trackers' | 'miners' | 'malware' | 'annoyances'
  description: string
  timestamp: number
}

// IPC Channel names
export const IPC_CHANNELS = {
  // Proxy
  PROXY_CONNECT: 'proxy:connect',
  PROXY_DISCONNECT: 'proxy:disconnect',
  PROXY_STATUS: 'proxy:status',

  // Tabs
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_SWITCH: 'tab:switch',

  // View
  VIEW_HIDE: 'view:hide',
  VIEW_SHOW: 'view:show',

  // Navigation
  NAVIGATE: 'navigate',
  GO_BACK: 'go-back',
  GO_FORWARD: 'go-forward',
  RELOAD: 'reload',
  STOP: 'stop',
  ZOOM_IN: 'zoom:in',
  ZOOM_OUT: 'zoom:out',
  ZOOM_RESET: 'zoom:reset',
  TOGGLE_DEVTOOLS: 'devtools:toggle',

  // Storage
  STORAGE_ADD_BAG: 'storage:add-bag',
  STORAGE_REMOVE_BAG: 'storage:remove-bag',
  STORAGE_LIST_BAGS: 'storage:list-bags',
  STORAGE_PAUSE_BAG: 'storage:pause-bag',
  STORAGE_GET_DETAILS: 'storage:get-details',
  STORAGE_OPEN_FOLDER: 'storage:open-folder',
  STORAGE_SHOW_FILE: 'storage:show-file',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Settings
  CLEAR_BROWSING_DATA: 'settings:clear-data',
  STORAGE_GET_DOWNLOAD_PATH: 'storage:get-download-path',
  STORAGE_SET_DOWNLOAD_PATH: 'storage:set-download-path',
  STORAGE_SELECT_DOWNLOAD_FOLDER: 'storage:select-download-folder',

  // App Settings
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',

  // Sidebar
  UPDATE_SIDEBAR_WIDTH: 'update-sidebar-width',

  // Bookmarks
  BOOKMARK_SHOW_MENU: 'bookmark:show-menu',

  // Folders
  FOLDER_SHOW_MENU: 'folder:show-menu',
  FOLDER_SHOW_CONTEXT_MENU: 'folder:show-context-menu',

  // History
  HISTORY_CHANGE_MODE: 'history:change-mode',
  HISTORY_SEARCH: 'history:search',
  HISTORY_GET_RECENT: 'history:get-recent',
  HISTORY_GET_TOP: 'history:get-top',
  HISTORY_GET_BY_DATE: 'history:get-by-date',
  HISTORY_DELETE: 'history:delete',
  HISTORY_DELETE_PATTERN: 'history:delete-pattern',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_GET_STATS: 'history:get-stats',
  HISTORY_HAS_PERSISTENT_FILE: 'history:has-persistent-file',

  // Errors
  ERRORS_GET_RECENT: 'errors:get-recent',
  ERRORS_CLEAR: 'errors:clear',

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
} as const
