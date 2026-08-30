import { createLogger } from '../../shared/logger'
import type { BridgeProvider } from '../ports/bridge-provider'
import { WsBridgeClient } from './ws-bridge-client'

const log = createLogger('ton-bridge:runtime')
const CONNECT_ATTEMPTS = 20
const CONNECT_RETRY_MS = 100

export type TonBridgeClientFactory = (wsPort: number) => WsBridgeClient

export class TonBridgeRuntime implements BridgeProvider<WsBridgeClient> {
  private bridge: WsBridgeClient | null = null
  private wsPort: number | null = null
  private operationTail: Promise<void> = Promise.resolve()
  private applyFlight: { port: number; promise: Promise<void> } | null = null
  private readonly listeners = new Set<(bridge: WsBridgeClient | null) => void>()
  private destroyed = false

  constructor(private readonly createClient: TonBridgeClientFactory = (wsPort) => new WsBridgeClient(wsPort)) {}

  getBridge(): WsBridgeClient | null {
    return this.bridge
  }

  onBridgeChanged(listener: (bridge: WsBridgeClient | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  applyPort(wsPort: number): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('TON bridge runtime destroyed'))
    if (this.applyFlight?.port === wsPort) return this.applyFlight.promise

    const promise = this.enqueue(() => this.applyPortUnlocked(wsPort)).finally(() => {
      if (this.applyFlight?.promise === promise) this.applyFlight = null
    })
    this.applyFlight = { port: wsPort, promise }
    return promise
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    await this.operationTail
    const bridge = this.bridge
    this.bridge = null
    this.wsPort = null
    bridge?.disconnect()
    this.emitBridgeChanged(null)
    this.listeners.clear()
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(
      () => {},
      () => {}
    )
    return result
  }

  private async applyPortUnlocked(wsPort: number): Promise<void> {
    if (this.destroyed) throw new Error('TON bridge runtime destroyed')
    const previous = this.bridge
    if (previous && this.wsPort === wsPort) {
      await this.connect(previous)
      return
    }

    const next = this.createClient(wsPort)
    try {
      await this.connect(next)
    } catch (error) {
      next.disconnect()
      throw error
    }
    if (this.destroyed) {
      next.disconnect()
      throw new Error('TON bridge runtime destroyed')
    }

    this.bridge = next
    this.wsPort = wsPort
    previous?.disconnect()
    this.emitBridgeChanged(next)
  }

  private async connect(bridge: WsBridgeClient): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
      try {
        await bridge.connect()
        return
      } catch (error) {
        lastError = error
        if (attempt < CONNECT_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS))
        }
      }
    }
    throw lastError
  }

  private emitBridgeChanged(bridge: WsBridgeClient | null): void {
    for (const listener of this.listeners) {
      try {
        listener(bridge)
      } catch (error) {
        log.error('TON bridge listener failed:', error)
      }
    }
  }
}
