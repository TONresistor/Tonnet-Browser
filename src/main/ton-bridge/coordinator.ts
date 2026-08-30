import { createLogger } from '../../shared/logger'
import type { BridgePermissionInterceptor } from '../bridge/permission-interceptor'
import type { ProxyManager } from '../proxy/manager'
import type { TonBridgeRuntime } from './runtime'

const log = createLogger('ton-bridge:coordinator')

export class TonBridgeCoordinator {
  private readonly onNativeBridgeReady = (wsPort: number): void => {
    void this.synchronize(wsPort).catch((error) => log.error(`Failed to synchronize bridge clients: ${String(error)}`))
  }
  private operationTail: Promise<void> | null = null
  private latest: { port: number; promise: Promise<void> } | null = null
  private readyPort: number | null = null
  private resolveFirstReady!: () => void
  private readonly firstReady = new Promise<void>((resolve) => {
    this.resolveFirstReady = resolve
  })
  private destroyed = false

  constructor(
    private readonly proxyManager: ProxyManager,
    private readonly runtime: TonBridgeRuntime,
    private readonly permissionInterceptor: BridgePermissionInterceptor
  ) {
    this.proxyManager.on('ws-bridge-ready', this.onNativeBridgeReady)
  }

  whenReady(): Promise<void> {
    return this.readyPort === null ? this.firstReady : Promise.resolve()
  }

  waitUntilReady(wsPort: number): Promise<void> {
    if (this.latest?.port === wsPort) return this.latest.promise
    if (this.readyPort === wsPort) return Promise.resolve()
    return Promise.reject(new Error(`Bridge port ${wsPort} has not been announced`))
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.proxyManager.off('ws-bridge-ready', this.onNativeBridgeReady)
    await this.operationTail?.catch(() => {})
    await this.runtime.destroy()
  }

  private synchronize(wsPort: number): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('TON bridge coordinator destroyed'))
    const run = async (): Promise<void> => {
      await Promise.all([this.runtime.applyPort(wsPort), this.permissionInterceptor.applyBridgePort(wsPort)])
      this.readyPort = wsPort
      this.resolveFirstReady()
    }
    const previous = this.operationTail
    const promise = previous ? previous.then(run, run) : run()
    this.operationTail = promise
    const clearTail = (): void => {
      if (this.operationTail === promise) this.operationTail = null
    }
    void promise.then(clearTail, clearTail)
    this.latest = { port: wsPort, promise }
    return promise
  }
}
