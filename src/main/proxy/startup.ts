/**
 * Shared proxy startup sequence.
 * Extracted to avoid duplication between auto-connect (index.ts) and manual connect (handlers.ts).
 */

import { BrowserWindow } from 'electron'
import { ProxyManager } from './manager'
import { StorageManager } from '../storage/daemon'
import { initTabManager } from '../windows/tabs'
import { createLogger } from '../../shared/logger'
const log = createLogger('proxy')

/**
 * Runs the 5-step proxy startup sequence with progress notifications.
 * Used by both auto-connect (on app ready) and manual connect (IPC handler).
 *
 * @param sendProgress - Callback to send progress step updates to the renderer
 * @param proxyManager - The ProxyManager instance to start
 * @param storageManager - The StorageManager instance to start
 * @param mainWindow - The main BrowserWindow (may be null if not yet available)
 */
export async function startProxySequence(
  sendProgress: (step: number, message: string) => void,
  proxyManager: ProxyManager,
  storageManager: StorageManager,
  mainWindow: BrowserWindow | null
): Promise<void> {
  // Step 0: Starting proxy
  sendProgress(0, 'Starting proxy...')
  await proxyManager.start()

  // Step 1: Loading configuration
  sendProgress(1, 'Loading configuration...')
  await new Promise((r) => setTimeout(r, 300)) // Small delay for visual feedback

  // Step 2: Starting DHT
  sendProgress(2, 'Starting DHT...')
  await new Promise((r) => setTimeout(r, 400))

  // Step 3: Connecting to network
  sendProgress(3, 'Connecting to network...')
  await new Promise((r) => setTimeout(r, 400))

  // Initialize TabManager with proxy port
  if (mainWindow) {
    initTabManager(mainWindow, proxyManager.getStatus().port)
  }

  // Start storage daemon (non-critical: continue even if it fails)
  try {
    await storageManager.start()
    log.info('Storage daemon started')
  } catch (storageError) {
    log.error(`Failed to start storage: ${String(storageError)}`)
  }

  // Step 4: Ready
  sendProgress(4, 'Ready!')
}
