export type BridgeEventCallback = (data: unknown) => void

/** Owns bridge push-event listeners independently from WebSocket transport. */
export class BridgeEventBus {
  private readonly listeners = new Map<string, Set<BridgeEventCallback>>()

  constructor(private readonly onListenerError: (event: string, error: unknown) => void) {}

  on(event: string, callback: BridgeEventCallback): () => void {
    let callbacks = this.listeners.get(event)
    if (!callbacks) {
      callbacks = new Set()
      this.listeners.set(event, callbacks)
    }
    callbacks.add(callback)
    return () => this.off(event, callback)
  }

  off(event: string, callback: BridgeEventCallback): void {
    const callbacks = this.listeners.get(event)
    if (!callbacks) return
    callbacks.delete(callback)
    if (callbacks.size === 0) this.listeners.delete(event)
  }

  emit(event: string, data: unknown): void {
    const callbacks = this.listeners.get(event)
    if (!callbacks) return
    for (const callback of [...callbacks]) {
      try {
        callback(data)
      } catch (error) {
        this.onListenerError(event, error)
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
}
