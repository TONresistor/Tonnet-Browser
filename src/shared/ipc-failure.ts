export interface IpcFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly retryable: boolean
    readonly details?: unknown
  }
}

export class IpcClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'IpcClientError'
  }
}

export function isIpcFailure(value: unknown): value is IpcFailure {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IpcFailure>
  return (
    candidate.ok === false &&
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    typeof candidate.error.code === 'string' &&
    typeof candidate.error.message === 'string' &&
    typeof candidate.error.retryable === 'boolean'
  )
}
