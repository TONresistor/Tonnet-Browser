/**
 * Wallet domain constants.
 * Used exclusively by main-process wallet modules.
 */

// --- File names ---
export const WALLET_FILE_NAME = 'wallet-key'
export const WALLET_HISTORY_FILE_NAME = 'wallet-history'

// --- Protocol constants ---
export const WALLET_MAX_TIMEOUT_S = 300
export const WALLET_MIN_APPROVAL_TIMEOUT_S = 5
export const TON_MAINNET_CAIP2 = 'tvm:-239'
export const TON_NATIVE_ASSET = 'native'
export const X402_VERSION = 2

// --- Rate limiting ---
export const RATE_LIMIT_MAX_PER_SECOND = 1
export const RATE_LIMIT_BURST_PER_10S = 3

// --- Payment interceptor ---
/** Hard cap on a single payment: 1 TON in nanoTON */
export const MAX_SINGLE_PAYMENT = 1_000_000_000n
/**
 * Default ceiling for a single ZERO-APPROVAL (auto mode) payment: 0.5 TON.
 * Auto payments above this escalate to a one-off manual approval instead of
 * executing silently, so a compromised auto-pay tonsite cannot drain the
 * wallet 1 TON at a time without the user ever being asked. A user-configured
 * limits.perRequest (non-'0') overrides this default.
 */
export const AUTO_PAY_DEFAULT_MAX_PER_REQUEST = 500_000_000n
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

// --- History / pagination ---
/** Default number of transactions to fetch from the chain per request */
export const WALLET_HISTORY_DEFAULT_LIMIT = 20
/** Number of local transactions to load for merge with on-chain results */
export const WALLET_HISTORY_LOCAL_PREFETCH = 100
/** Maximum transactions retained in the accumulated local cache */
export const WALLET_HISTORY_CACHE_LIMIT = 500
