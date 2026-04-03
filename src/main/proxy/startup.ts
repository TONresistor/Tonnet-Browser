/**
 * Shared proxy startup sequence.
 * Extracted to avoid duplication between auto-connect (index.ts) and manual connect (handlers.ts).
 */

import { BrowserWindow } from 'electron'
import { ProxyManager } from './manager'
import { StorageManager } from '../storage/daemon'
import { initTabManager, type TabManagerDeps } from '../windows/tabs'
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
    // eslint-disable-next-line no-control-regex
    const clean = message.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase()
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

  await proxyManager.start()
  proxyManager.off('log', logListener)

  // Initialize TabManager with proxy port
  if (mainWindow) {
    initTabManager(mainWindow, proxyManager.getStatus().port, tabDeps)
  }

  // Start storage daemon (non-critical)
  try {
    await storageManager.start()
    log.info('Storage daemon started')
  } catch (storageError) {
    log.error(`Failed to start storage: ${String(storageError)}`)
  }

  // Step 4: Ready
  sendProgress(4, 'Ready!')
}
