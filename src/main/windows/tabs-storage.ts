/**
 * Storage bag loading and error page rendering.
 * Extracted from tabs.ts to separate TON Storage concerns from tab lifecycle.
 */

import { WebContentsView } from 'electron'
import { EventEmitter } from 'events'
import { generateFileBrowserPage, generateLoadingPage } from './file-browser'
import type { StorageManager } from '../storage/daemon'
import { createLogger } from '../../shared/logger'
import type { BagDetails } from '../../shared/types'
import type { IDisposable } from '../utils/disposable'

const log = createLogger('tabs-storage')

// Module-level storage manager reference, set via setStorageManager()
let _storageManager: StorageManager | null = null

/** Set the StorageManager instance. Called once during tab manager initialization. */
export function setTabStorageManager(sm: StorageManager): void {
  _storageManager = sm
}

function getStorageManager(): StorageManager {
  if (!_storageManager)
    throw new Error('StorageManager not initialized in tabs-storage. Call setTabStorageManager() first.')
  return _storageManager
}

// Build-time constants: lottie player + loading animation baked by electron-vite
declare const __LOTTIE_PLAYER_JS__: string
declare const __LOADING_ANIMATION_JSON__: object

/** Cache of bag IDs detected by the proxy for .ton storage domains */
export const storageBagCache = new Map<string, string>()

/** Prevent concurrent loadStorageBrowser calls per webContents */
const storageBrowserLoading = new Set<number>()

/** Cache file browser HTML per webContentsId for back navigation */
export const fileBrowserCache = new Map<number, string>()

/** Initialize the storage-bag-detected listener on the proxy manager. Returns a disposable to remove it. */
export function initStorageListener(proxyMgr: EventEmitter): IDisposable {
  const handler = ({ bagId, domain }: { bagId: string; domain: string }): void => {
    storageBagCache.set(domain, bagId)
  }
  proxyMgr.on('storage-bag-detected', handler)
  return {
    dispose(): void {
      proxyMgr.removeListener('storage-bag-detected', handler)
    },
  }
}

// --- Helpers ---

export function sanitizeDirName(raw: string): string {
  const trimmed = raw.replace(/\/$/, '')
  return trimmed.replace(/\.\./g, '').replace(/[/\\]/g, '')
}

// --- Error page ---

export function loadErrorPage(view: WebContentsView, errorMessage: string, failedUrl: string): void {
  const wc = view?.webContents
  if (!wc || wc.isDestroyed()) {
    log.debug('loadErrorPage skipped: view missing or destroyed')
    return
  }
  const safeError = errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeUrl = failedUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const encodedUrl = encodeURIComponent(failedUrl)
  const animJson = JSON.stringify(__LOADING_ANIMATION_JSON__)

  const errorHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Load Error</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #17212b;
      color: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .error-container {
      max-width: 480px;
      text-align: center;
      background: rgba(255, 255, 255, 0.07);
      backdrop-filter: blur(12px) saturate(1.4);
      -webkit-backdrop-filter: blur(12px) saturate(1.4);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      padding: 40px 32px 32px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .lottie-wrapper {
      width: 180px;
      height: 180px;
      margin: 0 auto 24px;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #f5f5f5;
    }
    .error-message {
      font-size: 14px;
      line-height: 1.6;
      color: #708499;
      margin-bottom: 20px;
    }
    .error-details {
      background: #0e1621;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 24px;
      text-align: left;
    }
    .error-code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #ec3942;
      word-break: break-all;
      line-height: 1.5;
    }
    .url {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #708499;
      margin-top: 6px;
      word-break: break-all;
      line-height: 1.5;
    }
    .actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    button {
      padding: 10px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 500;
      border: none;
      border-radius: 1000px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #0098ea;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0, 152, 234, 0.3);
    }
    .btn-primary:hover {
      background: #007bc7;
      box-shadow: 0 4px 12px rgba(0, 152, 234, 0.4);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      color: #f5f5f5;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div id="lottie" class="lottie-wrapper"></div>
    <h1>Unable to Load Page</h1>
    <p class="error-message">The page could not be loaded. Check your connection to the TON network.</p>
    <div class="error-details">
      <div class="error-code">Error: ${safeError}</div>
      <div class="url">URL: ${safeUrl}</div>
    </div>
    <div class="actions">
      <button class="btn-primary" data-url="${encodedUrl}" onclick="location.href=decodeURIComponent(this.dataset.url)">Retry</button>
      <button class="btn-secondary" onclick="history.back()">Go Back</button>
    </div>
  </div>
  <script>${__LOTTIE_PLAYER_JS__}</script>
  <script>
    try {
      lottie.loadAnimation({
        container: document.getElementById('lottie'),
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: ${animJson}
      });
    } catch(e) {}
  </script>
</body>
</html>`

  wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).catch((err) => {
    log.error('Failed to load error page:', err)
  })
}

// --- Storage bag loading ---

interface LoadStorageBagOptions {
  /** Direct bag ID (for ton://storage explicit loads) */
  bagId?: string
  /** Domain to look up bag ID from proxy cache */
  domain?: string
  /** Display label for loading page */
  label: string
  /** Max seconds to wait for bag files (default: 30) */
  timeout?: number
  /** Check fileBrowserCache before loading (default: false) */
  useCache?: boolean
  /** Try loading index.html if present (default: false) */
  checkIndexHtml?: boolean
}

/**
 * Load a TON Storage bag into a WebContentsView.
 * Handles both explicit bag ID loads (ton://storage) and domain-based loads (proxy cache).
 * Shows loading page, downloads bag if needed, then shows file browser or index.html.
 */
export async function loadStorageBag(view: WebContentsView, opts: LoadStorageBagOptions): Promise<void> {
  const { label, timeout = 30, useCache = false, checkIndexHtml = false } = opts

  // Check cache first (for back navigation)
  if (useCache) {
    const cached = fileBrowserCache.get(view.webContents.id)
    if (cached) {
      await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cached)}`)
      return
    }
  }

  // Resolve bag ID
  const bagId = opts.bagId ?? storageBagCache.get(opts.domain ?? '')
  if (!bagId) throw new Error('No storage bag detected for this domain')

  // Show loading page
  const loadingHtml = generateLoadingPage(label)
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`)

  // Ensure bag is in daemon
  let details: BagDetails | null = null
  try {
    details = await getStorageManager().getBagDetails(bagId)
  } catch {
    log.debug(`Bag ${bagId} not in daemon, adding`)
    await getStorageManager().addBag(bagId)
  }

  // Wait for files
  if (!details || details.files.length === 0) {
    for (let i = 0; i < timeout; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        details = await getStorageManager().getBagDetails(bagId)
        if (details.files.length > 0) break
      } catch {
        log.debug(`Waiting for bag ${bagId} files (${i + 1}/${timeout})`)
      }
    }
  }

  if (!details || details.files.length === 0) {
    if (opts.domain) {
      throw new Error('Bag has no files or failed to load')
    }
    loadErrorPage(view, 'Bag has no files or download timed out', `${bagId}.bag`)
    return
  }

  const dirName = sanitizeDirName(details.dir_name || '')
  const basePath = dirName ? `${details.path}/${dirName}` : details.path

  // If index.html exists and caller wants website mode, load it
  if (checkIndexHtml && details.files.some((f) => f.name === 'index.html')) {
    log.info('Bag has index.html, loading as website')
    await view.webContents.loadFile(`${basePath}/index.html`)
    return
  }

  // Show file browser
  const displayName = opts.domain ?? details.description ?? bagId.slice(0, 16)
  const html = generateFileBrowserPage(displayName, bagId, details.files, '/', basePath)
  fileBrowserCache.set(view.webContents.id, html)
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

/**
 * Attempt to load a TON Storage file browser for a .ton domain.
 * Guards against concurrent calls for the same webContents.
 */
export async function loadStorageBrowser(view: WebContentsView, domain: string): Promise<void> {
  const wcId = view.webContents.id
  if (storageBrowserLoading.has(wcId)) return
  storageBrowserLoading.add(wcId)

  try {
    await loadStorageBag(view, { domain, label: domain, timeout: 30 })
  } finally {
    storageBrowserLoading.delete(wcId)
  }
}
