/**
 * Shared types.
 * Used by both main and renderer processes.
 */

export interface Tab {
  id: string
  url: string
  title: string
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

// Theme customization
export interface ThemeColors {
  // Core
  background: string           // HSL: "210 26% 13%"
  backgroundSecondary: string
  foreground: string
  card: string
  cardForeground: string

  // Primary/Accent
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  accent: string
  accentForeground: string

  // Muted
  muted: string
  mutedForeground: string

  // Status
  destructive: string
  destructiveForeground: string
  success: string
  successForeground: string
  warning: string
  warningForeground: string
  info: string
  infoForeground: string

  // Border/Input
  border: string
  input: string
  ring: string
}

export interface CustomTheme {
  id: string
  name: string
  description?: string
  colors: ThemeColors
  isDark: boolean
  createdAt: number
  updatedAt: number
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
  STORAGE_RESUME_BAG: 'storage:resume-bag',
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
} as const
