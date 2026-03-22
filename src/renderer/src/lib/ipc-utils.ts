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
