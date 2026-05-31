/**
 * IPC handlers for proxy connection management.
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { secureHandle, emitToRenderer, log } from './shared'
import { startProxySequence } from '../../proxy/startup'
import { getMainWindow } from '../../windows/main'
import type { ServiceRegistry } from '../../services'

export function registerProxyHandlers(registry: ServiceRegistry): void {
  const { proxyManager, storageManager, overlayManager, historyManager, contentFilterManager, paymentInterceptor } =
    registry

  // ===== Proxy Status Events =====
  proxyManager.on('status', (status) => {
    emitToRenderer('proxy:status', proxyManager.getStatus())
    // Update window title to show connection status
    const win = getMainWindow()
    if (win) {
      const title = status === 'connected' ? 'TON Browser [Connected]' : 'TON Browser'
      win.setTitle(title)
    }
  })

  proxyManager.on('error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Proxy Handlers =====
  secureHandle(IPC_CHANNELS.PROXY_CONNECT, async () => {
    const win = getMainWindow()

    // Helper to send progress updates
    const sendProgress = (step: number, message: string) => {
      emitToRenderer(IPC_CHANNELS.PROXY_PROGRESS, { step, message })
    }

    const tabDeps = {
      overlayManager,
      proxyManager,
      storageManager,
      historyManager,
      contentFilterManager,
      paymentInterceptor,
    }
    await startProxySequence(sendProgress, proxyManager, storageManager, win, tabDeps)

    return { success: true, ...proxyManager.getStatus() }
  })

  secureHandle(IPC_CHANNELS.PROXY_DISCONNECT, async () => {
    storageManager.stop()
    await proxyManager.stop()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.PROXY_STATUS, () => {
    return proxyManager.getStatus()
  })
}
