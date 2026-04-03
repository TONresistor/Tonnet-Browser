/**
 * Shared constants.
 * Used by both main and renderer processes.
 * Main-only constants live in src/main/{domain}/constants.ts.
 */

export const APP_NAME = 'TON Browser'
export const APP_VERSION: string = __APP_VERSION__

// Internal pages
export const TON_WALLET_PAGE = 'ton://wallet'

// Default bookmarks shown on first run
export const DEFAULT_BOOKMARKS = [
  { id: '0', url: 'http://manifesto.ton', title: 'manifesto.ton', createdAt: Date.now() },
  { id: '1', url: 'http://dnslookup.ton', title: 'dnslookup.ton', createdAt: Date.now() },
]

// UI timing
export const UI_COPY_FEEDBACK_MS = 2_000
export const UI_NOTIFICATION_TIMEOUT_MS = 3_000
export const UI_ERROR_TIMEOUT_MS = 5_000

// UI dimensions (used by main process for view bounds calculation AND shared with renderer)
export const UI_DIMENSIONS = {
  TABBAR_HEIGHT: 44,
  NAVBAR_HEIGHT: 46,
  BOOKMARKS_HEIGHT: 44,
  STATUSBAR_HEIGHT: 24,
  DEFAULT_SIDEBAR_WIDTH: 240,
} as const
