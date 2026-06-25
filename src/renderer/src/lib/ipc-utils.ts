export interface IpcErrorResult {
  success: false
  error?: string
}

export function isIpcError(result: unknown): result is IpcErrorResult {
  return (
    typeof result === 'object' && result !== null && 'success' in result && (result as IpcErrorResult).success === false
  )
}

export function getIpcError(result: unknown): string | null {
  if (isIpcError(result)) return result.error ?? 'Operation failed'
  return null
}

/**
 * Unwrap a `Promise.allSettled` entry: the fulfilled value cast to `T`, unless
 * it rejected or is an IPC error envelope (then `null`). Collapses the repeated
 * `status === 'fulfilled' && !isIpcError(value)` guard into one call.
 */
export function unwrapSettled<T>(result: PromiseSettledResult<unknown>): T | null {
  if (result.status !== 'fulfilled') return null
  if (isIpcError(result.value)) return null
  return result.value as T
}
