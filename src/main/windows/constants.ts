/**
 * Windows domain constants.
 * Used exclusively by main-process window/view modules.
 */

// --- Main window defaults ---
export const DEFAULT_WINDOW_WIDTH = 1_280
export const DEFAULT_WINDOW_HEIGHT = 800
export const MIN_WINDOW_WIDTH = 800
export const MIN_WINDOW_HEIGHT = 600
export const WINDOW_BACKGROUND_COLOR = '#0a0a0a'

// --- Context menu ---
export const CONTEXT_MENU_WIDTH = 220

// --- Bounds persistence ---
export const BOUNDS_SAVE_DEBOUNCE_MS = 500

// --- Overlay manager ---
/** Delay before registering blur listener to let focus stabilize */
export const OVERLAY_SETUP_DELAY_MS = 200
/** Debounce for click-outside dismiss to avoid race with focus */
export const OVERLAY_DISMISS_DEBOUNCE_MS = 50
/** Number of pre-created overlay views in the pool */
export const OVERLAY_POOL_SIZE = 2

// --- Tabs bounds cache ---
/** Duration before cached appearance settings are refreshed */
export const APPEARANCE_CACHE_VALIDITY_MS = 500

// --- Session and identity (main-only) ---
export const DEFAULT_PROXY_PORT = 8_080
export const SESSION_PARTITION = 'persist:ton-browser'

/**
 * Privacy: Generic User-Agent without TONBrowser identifier.
 * Chrome version matches Electron 41 (Chromium 146).
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

/** Maximum favicon blob size accepted from web pages */
export const FAVICON_MAX_SIZE_BYTES = 50_000
