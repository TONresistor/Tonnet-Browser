export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
export class WalletEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message)
    this.name = 'WalletEngineError'
  }
}
