import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { BridgePermissionInterceptor } from '../../bridge/permission-interceptor'
import type { ProxyManager } from '../../proxy/manager'
import { TonBridgeCoordinator } from '../coordinator'
import type { TonBridgeRuntime } from '../runtime'

function createHarness() {
  const proxy = new EventEmitter() as unknown as ProxyManager
  const runtime = {
    applyPort: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
  } as unknown as TonBridgeRuntime
  const interceptor = {
    applyBridgePort: vi.fn(() => Promise.resolve()),
  } as unknown as BridgePermissionInterceptor
  const coordinator = new TonBridgeCoordinator(proxy, runtime, interceptor)
  return { coordinator, interceptor, proxy, runtime }
}

describe('TonBridgeCoordinator', () => {
  it('is the single synchronization path for native Bridge readiness', async () => {
    const { coordinator, interceptor, proxy, runtime } = createHarness()
    const firstReady = coordinator.whenReady()

    proxy.emit('ws-bridge-ready', 8081)
    await Promise.all([firstReady, coordinator.waitUntilReady(8081)])

    expect(runtime.applyPort).toHaveBeenCalledOnce()
    expect(runtime.applyPort).toHaveBeenCalledWith(8081)
    expect(interceptor.applyBridgePort).toHaveBeenCalledOnce()
    expect(interceptor.applyBridgePort).toHaveBeenCalledWith(8081)
  })

  it('resynchronizes after a restart on the same port', async () => {
    const { coordinator, proxy, runtime } = createHarness()

    proxy.emit('ws-bridge-ready', 8081)
    await coordinator.waitUntilReady(8081)
    proxy.emit('ws-bridge-ready', 8081)
    await coordinator.waitUntilReady(8081)

    expect(runtime.applyPort).toHaveBeenCalledTimes(2)
  })
})
