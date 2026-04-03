/**
 * Process supervisor constants.
 * Used by the upcoming ProcessSupervisor (T5).
 */

/** Grace period before SIGKILL after SIGTERM */
export const PROCESS_KILL_TIMEOUT_MS = 5_000

/** Base delay for exponential backoff on restart */
export const BACKOFF_BASE_MS = 1_000

/** Maximum backoff delay cap */
export const BACKOFF_MAX_MS = 60_000

/** Maximum restarts before giving up */
export const MAX_RESTARTS = 5

/** Time after which the restart counter resets to zero */
export const HEALTH_RESET_AFTER_MS = 300_000

/** Interval between health probe checks */
export const HEALTH_PROBE_INTERVAL_MS = 10_000

/** Timeout for a single health probe */
export const HEALTH_PROBE_TIMEOUT_MS = 3_000

/** Number of consecutive probe failures before declaring unhealthy */
export const HEALTH_FAILURE_THRESHOLD = 3
