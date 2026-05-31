/**
 * Shared proxy startup sequence.
 * Extracted to avoid duplication between auto-connect (index.ts) and manual connect (handlers.ts).
 */

import { BrowserWindow } from 'electron'
import { ProxyManager } from './manager'
import { StorageManager } from '../storage/daemon'
import { initTabManager, type TabManagerDeps } from '../windows/tabs'
import { stripAnsi } from '../utils/strip-ansi'
import { createLogger } from '../../shared/logger'
const log = createLogger('proxy')

/**
 * Runs the proxy startup sequence with real progress from tunnel logs.
 */
export async function startProxySequence(
  sendProgress: (step: number, message: string) => void,
  proxyManager: ProxyManager,
  storageManager: StorageManager,
  mainWindow: BrowserWindow | null,
  tabDeps?: TabManagerDeps
): Promise<void> {
  // Step 0: Starting proxy binary
  sendProgress(0, 'Starting proxy...')

  // Listen for tunnel progress events from proxy logs
  const logListener = (message: string) => {
    const clean = stripAnsi(message).toLowerCase()
    if (clean.includes('fetching ton network config')) {
      sendProgress(1, 'Fetching TON network config...')
    } else if (clean.includes('initializing adnl tunnel') || clean.includes('initializing dht')) {
      sendProgress(2, 'Connecting to TON DHT...')
    } else if (clean.includes('configuring route')) {
      sendProgress(2, 'Building tunnel route...')
    } else if (clean.includes('tunnel is ready') || clean.includes('tunnel updated')) {
      sendProgress(3, 'Tunnel connected!')
    }
  }
  proxyManager.on('log', logListener)

  // Storage has no dependency on proxy: start in parallel
  const storagePromise = storageManager
    .start()
    .then(() => log.info('Storage daemon started'))
    .catch((err) => log.error(`Failed to start storage: ${String(err)}`))

  await proxyManager.start()
  proxyManager.off('log', logListener)

  // Initialize TabManager with proxy port
  if (mainWindow) {
    initTabManager(mainWindow, proxyManager.getStatus().port, tabDeps)
  }

  // Wait for storage to finish (likely already done)
  await storagePromise

  // Step 4: Ready
  sendProgress(4, 'Ready!')
}
