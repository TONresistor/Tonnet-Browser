export interface JsonRpcResponse {
  id: string | number
  result?: unknown
  error?: { code: number; message?: string }
}

interface PendingRequest {
  resolve(value: unknown): void
  reject(reason: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Owns JSON-RPC request correlation and settlement.
 *
 * Transport code is responsible only for sending bytes. This tracker ensures
 * timeout, send failure, response, disconnect, and late duplicate responses
 * settle each request at most once.
 */
export class JsonRpcRequestTracker {
  private readonly pending = new Map<string, PendingRequest>()

  wait(id: string, method: string, timeoutMs: number): Promise<unknown> {
    if (this.pending.has(id)) throw new Error(`Duplicate JSON-RPC request id: ${id}`)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reject(id, new Error(`Request timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  settle(message: JsonRpcResponse): boolean {
    const entry = this.take(String(message.id))
    if (!entry) return false

    if (message.error) {
      entry.reject(new Error(message.error.message ?? `RPC error ${message.error.code}`))
    } else {
      entry.resolve(message.result)
    }
    return true
  }

  reject(id: string, error: Error): boolean {
    const entry = this.take(id)
    if (!entry) return false
    entry.reject(error)
    return true
  }

  rejectAll(error: Error): void {
    const ids = [...this.pending.keys()]
    for (const id of ids) this.reject(id, error)
  }

  get size(): number {
    return this.pending.size
  }

  private take(id: string): PendingRequest | undefined {
    const entry = this.pending.get(id)
    if (!entry) return undefined
    this.pending.delete(id)
    clearTimeout(entry.timer)
    return entry
  }
}
