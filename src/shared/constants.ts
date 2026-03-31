/**
 * Shared constants.
 * Used by both main and renderer processes.
 */

export const APP_NAME = 'TON Browser'
export const APP_VERSION: string = __APP_VERSION__

export const DEFAULT_PROXY_PORT = 8080
export const DEFAULT_STORAGE_PORT = 5555

export const TON_START_PAGE = 'ton://start'
export const TON_STORAGE_PAGE = 'ton://storage'
export const TON_SETTINGS_PAGE = 'ton://settings'

export const DEFAULT_BOOKMARKS = [
  { id: '0', url: 'http://manifesto.ton', title: 'manifesto.ton', createdAt: Date.now() },
  { id: '1', url: 'http://dnslookup.ton', title: 'dnslookup.ton', createdAt: Date.now() },
]

// Privacy: Generic User-Agent without TONBrowser identifier
// Chrome version matches Electron 41 (Chromium 146)
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

// Wallet
export const TON_WALLET_PAGE = 'ton://wallet'
export const WALLET_FILE_NAME = 'wallet-key'
export const WALLET_HISTORY_FILE_NAME = 'wallet-history'
export const WALLET_BALANCE_POLL_INTERVAL = 30000
export const WALLET_SEQNO_SYNC_INTERVAL = 30000
export const WALLET_MAX_TIMEOUT_SECONDS = 300
export const TON_MAINNET_CAIP2 = 'tvm:-239'
export const TON_NATIVE_ASSET = 'native'
export const X402_VERSION = 2
export const RATE_LIMIT_MAX_PER_SECOND = 1
export const RATE_LIMIT_BURST_PER_10S = 3

// UI timing
export const UI_COPY_FEEDBACK_MS = 2000
export const UI_NOTIFICATION_TIMEOUT_MS = 3000
export const UI_ERROR_TIMEOUT_MS = 5000

// Security limits
export const FAVICON_MAX_SIZE_BYTES = 50_000

// UI dimensions (used by main process for view bounds calculation)
export const UI_DIMENSIONS = {
  TABBAR_HEIGHT: 44,
  NAVBAR_HEIGHT: 46,
  BOOKMARKS_HEIGHT: 44,
  STATUSBAR_HEIGHT: 24,
  DEFAULT_SIDEBAR_WIDTH: 240,
} as const

// Session partition identifier (used in main process for session management)
export const SESSION_PARTITION = 'persist:ton-browser'

// Default background color for windows
export const BACKGROUND_COLOR = '#0a0a0a'
