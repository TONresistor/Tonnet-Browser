/**
 * Storage domain constants.
 * Used exclusively by main-process storage modules.
 */

/** Delay between daemon readiness ping attempts */
export const PING_RETRY_DELAY_MS = 500

/** Maximum ping attempts before declaring daemon unready */
export const PING_MAX_ATTEMPTS = 30

/** HTTP request timeout for storage API calls */
export const HTTP_TIMEOUT_MS = 10_000

/** Max error text length to include in HTTP error messages */
export const ERROR_TRUNCATE_LENGTH = 200
