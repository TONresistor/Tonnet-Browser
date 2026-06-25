/**
 * Cross-process error helpers (no main- or renderer-only dependencies).
 */

/**
 * Extract a human-readable message from an unknown caught value or rejected
 * Promise reason. Mirrors toError(reason).message: a real Error yields its
 * message, null/undefined yield a descriptive string instead of the misleading
 * "null"/"undefined", and anything else is stringified.
 *
 * Safer than `(x as Error).message`, which throws a TypeError when x is null.
 */
export function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (reason == null) return 'Unknown error'
  return String(reason)
}
