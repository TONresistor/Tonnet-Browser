/**
 * IPC handlers for proxy connection management.
 */

import { log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import { startProxySequence } from '../../proxy/startup'
import type { ServiceRegistry } from '../../services'
import {
  proxyConnectContract,
  proxyDisconnectContract,
  proxyProgressEventContract,
  proxyStatusContract,
  proxyStatusEventContract,
} from '../../../shared/ipc-contract/proxy'
import { ipcFailure, ownIpcEmitterListener, secureContractHandle } from '../contract-handler'

export function registerProxyHandlers(registry: ServiceRegistry): void {
  const { proxyManager, storageManager } = registry
  let statusRevision = 0

  const getSynchronizedStatus = async () => {
    while (true) {
      const runtimeStatus = proxyManager.getStatus()
      if (runtimeStatus.status !== 'connected') return runtimeStatus
      await registry.tabManager.updateProxyPort(runtimeStatus.port)
      const currentStatus = proxyManager.getStatus()
      if (currentStatus.status === 'connected' && currentStatus.port !== runtimeStatus.port) continue
      return currentStatus
    }
  }

  const publishCurrentStatus = (): void => {
    const runtimeStatus = proxyManager.getStatus()
    emitContractToRenderer(proxyStatusEventContract, runtimeStatus)
    const win = registry.tabManager.window
    if (win) {
      win.setTitle(runtimeStatus.status === 'connected' ? 'TON Browser [Connected]' : 'TON Browser')
    }
  }

  // ===== Proxy Status Events =====
  ownIpcEmitterListener(proxyManager, 'status', (status) => {
    const revision = ++statusRevision
    if (status === 'connected') {
      const runtimeStatus = proxyManager.getStatus()
      void registry.tabManager
        .updateProxyPort(runtimeStatus.port)
        .then(() => {
          if (revision === statusRevision && proxyManager.getStatus().status === 'connected') publishCurrentStatus()
        })
        .catch((error) => {
          log.error(`Failed to update browser proxy port: ${String(error)}`)
          if (revision === statusRevision) {
            emitContractToRenderer(proxyStatusEventContract, { status: 'error', error: String(error) })
          }
        })
      return
    }
    publishCurrentStatus()
  })

  ownIpcEmitterListener(proxyManager, 'error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Proxy Handlers =====
  secureContractHandle(proxyConnectContract, async () => {
    // Helper to send progress updates
    const sendProgress = (step: number, message: string) => {
      emitContractToRenderer(proxyProgressEventContract, { step, message })
    }

    try {
      await startProxySequence(sendProgress, proxyManager, storageManager)
    } catch (error) {
      ipcFailure('PROXY_START_FAILED', 'Operation failed', false, error)
    }
    return { ...(await getSynchronizedStatus()), success: true as const }
  })

  secureContractHandle(proxyDisconnectContract, async () => {
    await Promise.all([storageManager.stop(), proxyManager.stop()])
    return { success: true }
  })

  secureContractHandle(proxyStatusContract, getSynchronizedStatus)
}
