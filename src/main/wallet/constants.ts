/**
 * Wallet domain constants.
 * Used exclusively by main-process wallet modules.
 */

// --- File names ---
export const WALLET_FILE_NAME = 'wallet-key'
export const WALLET_HISTORY_FILE_NAME = 'wallet-history'

// --- Protocol constants ---
export const WALLET_MAX_TIMEOUT_S = 300
export const TON_MAINNET_CAIP2 = 'tvm:-239'
export const TON_NATIVE_ASSET = 'native'
export const X402_VERSION = 2

// --- Rate limiting ---
export const RATE_LIMIT_MAX_PER_SECOND = 1
export const RATE_LIMIT_BURST_PER_10S = 3

// --- Payment interceptor ---
/** Hard cap on a single payment: 1 TON in nanoTON */
export const MAX_SINGLE_PAYMENT = 1_000_000_000n
/** Fetch timeout for session re-fetch of 402 URLs */
export const FETCH_TIMEOUT_MS = 30_000
/** Default maxTimeoutSeconds when server omits the field */
export const DEFAULT_APPROVAL_TIMEOUT_S = 60

// --- Payment policy ---
/** Cleanup interval for stale spending records */
export const POLICY_CLEANUP_INTERVAL_MS = 5 * 60 * 1_000
/** Debounce delay for persisting spending records */
export const POLICY_SAVE_DEBOUNCE_MS = 5_000
/** Spending records older than this are pruned */
export const SPENDING_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
/** Rolling window for per-day spending checks */
export const ONE_DAY_MS = 24 * 60 * 60 * 1_000
/** Rate limit window for burst detection */
export const RATE_LIMIT_WINDOW_MS = 10_000
/** Rate limit: 1-second check window */
export const RATE_LIMIT_ONE_SECOND_MS = 1_000

// --- Key storage ---
/** Default auto-lock timer duration */
export const AUTO_LOCK_DEFAULT_MS = 5 * 60 * 1_000
