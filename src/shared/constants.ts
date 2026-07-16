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

export const PAGE_ZOOM = {
  MIN_PERCENT: 30,
  MAX_PERCENT: 200,
  STEP_PERCENT: 10,
} as const

// Tunnel mode → section count mapping (used by proxy manager and status bar)
export const TUNNEL_SECTIONS: Record<'standard' | 'maximum', number> = { standard: 2, maximum: 3 }

// Error truncation
/** Max characters of error text to include in user-facing messages */
export const ERROR_TRUNCATE_LENGTH = 200

/** Max transactions kept in the wallet store to bound memory during long sessions */
export const WALLET_TX_DISPLAY_CAP = 100

/**
 * Max UTF-8 byte length of an outgoing transfer comment (memo).
 * On-chain comments are stored in clear text as a snake-encoded string and
 * inflate the external message and fees, so we bound them. 256 bytes
 * comfortably covers exchange memos and short notes. Enforced byte-accurately
 * (not by JS string length) in both the SendForm UI and the WALLET_SEND IPC
 * handler (the trust boundary).
 */
export const WALLET_MAX_COMMENT_BYTES = 256
