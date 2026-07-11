/**
 * IPC handlers for proxy connection management.
 */

import { log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import { startProxySequence } from '../../proxy/startup'
import { getMainWindow } from '../../windows/main'
import type { ServiceRegistry } from '../../services'
import {
  proxyConnectContract,
  proxyDisconnectContract,
  proxyProgressEventContract,
  proxyStatusContract,
  proxyStatusEventContract,
} from '../../../shared/ipc-contract/proxy'
import { ownIpcEmitterListener, secureContractHandle } from '../contract-handler'

export function registerProxyHandlers(registry: ServiceRegistry): void {
  const { proxyManager, storageManager, overlayManager, historyManager, contentFilterManager, paymentInterceptor } =
    registry

  // ===== Proxy Status Events =====
  ownIpcEmitterListener(proxyManager, 'status', (status) => {
    emitContractToRenderer(proxyStatusEventContract, proxyManager.getStatus())
    // Update window title to show connection status
    const win = getMainWindow()
    if (win) {
      const title = status === 'connected' ? 'TON Browser [Connected]' : 'TON Browser'
      win.setTitle(title)
    }
  })

  ownIpcEmitterListener(proxyManager, 'error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Proxy Handlers =====
  secureContractHandle(proxyConnectContract, async () => {
    const win = getMainWindow()

    // Helper to send progress updates
    const sendProgress = (step: number, message: string) => {
      emitContractToRenderer(proxyProgressEventContract, { step, message })
    }

    const tabDeps = {
      overlayManager,
      proxyManager,
      storageManager,
      historyManager,
      contentFilterManager,
      paymentInterceptor,
    }
    await startProxySequence(sendProgress, proxyManager, storageManager, win, registry.tabManager, tabDeps)

    return { ...proxyManager.getStatus(), success: true as const }
  })

  secureContractHandle(proxyDisconnectContract, async () => {
    storageManager.stop()
    await proxyManager.stop()
    return { success: true }
  })

  secureContractHandle(proxyStatusContract, () => {
    return proxyManager.getStatus()
  })
}
