/**
 * IPC handlers for proxy connection management.
 */

import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandle, handleSecure, log } from './shared'
import { proxyManager } from '../../proxy/manager'
import { storageManager } from '../../storage/daemon'
import { startProxySequence } from '../../proxy/startup'
import { getMainWindow } from '../../windows/main'

export function registerProxyHandlers(): void {
  // ===== Proxy Status Events =====
  proxyManager.on('status', (status) => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('proxy:status', proxyManager.getStatus())
      // Update window title to show connection status
      const title = status === 'connected' ? 'TON Browser [Connected]' : 'TON Browser'
      win.setTitle(title)
    }
  })

  proxyManager.on('error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Proxy Handlers =====
  handleSecure(IPC_CHANNELS.PROXY_CONNECT, async () => {
    const win = getMainWindow()

    // Helper to send progress updates
    const sendProgress = (step: number, message: string) => {
      if (win) {
        win.webContents.send('proxy:progress', { step, message })
      }
    }

    await startProxySequence(sendProgress, proxyManager, storageManager, win)

    return { success: true, ...proxyManager.getStatus() }
  })

  secureHandle(IPC_CHANNELS.PROXY_DISCONNECT, async () => {
    storageManager.stop()
    proxyManager.stop()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.PROXY_STATUS, () => {
    return proxyManager.getStatus()
  })
}
