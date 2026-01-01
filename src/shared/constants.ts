/**
 * Shared constants.
 * Used by both main and renderer processes.
 */

export const APP_NAME = 'TON Browser'
export const APP_VERSION = '1.0.0'

export const DEFAULT_PROXY_PORT = 8080
export const DEFAULT_STORAGE_PORT = 5555

export const TON_START_PAGE = 'ton://start'
export const TON_STORAGE_PAGE = 'ton://storage'
export const TON_SETTINGS_PAGE = 'ton://settings'

export const DEFAULT_BOOKMARKS = [
  { id: '0', url: 'http://tonnet-sync-check.ton', title: 'sync-check', createdAt: Date.now() },
  { id: '1', url: 'http://boards.ton', title: 'boards.ton', createdAt: Date.now() },
  { id: '2', url: 'http://piracy.ton', title: 'piracy.ton', createdAt: Date.now() },
]

// Privacy: Generic User-Agent without TONBrowser identifier
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
