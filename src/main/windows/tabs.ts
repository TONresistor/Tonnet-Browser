/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages WebContentsViews.
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { createBrowserView, setSessionDeps } from './browser-view'
import {
  extractDomain,
  getSessionForDomain,
  updateDomainActivity,
  setTabDomain,
  getTabDomain,
  cleanupDomainForTab,
  onPrivacySettingsChanged as sessionPrivacyChanged,
  initCookieAutoDelete,
} from './tabs-session'
import {
  loadStorageBag,
  loadErrorPage,
  fileBrowserCache as _fileBrowserCache,
  initStorageListener,
  setTabStorageManager,
} from './tabs-storage'
import { updateViewBounds, updateSidebarBounds, invalidateAppearanceCache } from './tabs-bounds'
import { setupSecurityHandlers, ALLOWED_SCHEMES } from './tabs-security'
import { setupViewEventListeners, setTabEventDeps } from './tabs-events'
import { DisposableStore, IDisposable, onWebContents } from '../utils/disposable'
import type { OverlayManager } from './overlay-manager'
import type { ProxyManager } from '../proxy/manager'
import type { StorageManager } from '../storage/daemon'
import type { HistoryManager } from '../history/manager'
import type { ContentFilterManager } from '../content-filter/filter-manager'
import type { PaymentInterceptor } from '../wallet/payment-interceptor'

// Re-export for backward compatibility (used by navigation.ts dynamic import)
export const fileBrowserCache = _fileBrowserCache
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { createLogger } from '../../shared/logger'
import { emitToRenderer } from '../ipc/handlers/shared'
import { normalizeUrl } from '../../shared/utils/url'

const log = createLogger('tabs')

// Map of all WebContentsViews by tabId
const views = new Map<string, WebContentsView>()
const viewDisposables = new Map<string, DisposableStore>()
let activeViewId: string | null = null
let mainWindow: BrowserWindow | null = null
let proxyPort: number = DEFAULT_SETTINGS.proxyPort

// Store resize handler reference to prevent listener accumulation on reconnect
let resizeHandler: (() => void) | null = null
let storageListenerDisposable: IDisposable | null = null

let currentWalletSidebarWidth = 0

// Module-level overlay manager reference, set via initTabManager
let _overlayManager: OverlayManager | null = null

// Re-export for settings.ts
export function onPrivacySettingsChanged(): void {
  sessionPrivacyChanged()
}

// Update view bounds when appearance settings change (called from IPC handlers)
export function onAppearanceSettingsChanged(): void {
  invalidateAppearanceCache()
  const activeView = getActiveView()
  if (activeView && mainWindow) {
    updateViewBounds(activeView, mainWindow, currentWalletSidebarWidth)
  }
}

// Immediate sidebar width update (for real-time resize without settings persistence)
export function updateSidebarWidth(width: number): void {
  const activeView = getActiveView()
  if (!activeView || !mainWindow) return

  updateSidebarBounds(activeView, mainWindow, width)
}

export function updateWalletSidebarWidth(width: number): void {
  currentWalletSidebarWidth = width
  if (!mainWindow) return
  for (const view of mainWindow.contentView.children) {
    if (view instanceof WebContentsView) {
      updateViewBounds(view as WebContentsView, mainWindow!, currentWalletSidebarWidth)
    }
  }
}

/** Dependencies needed to initialize the tab manager */
export interface TabManagerDeps {
  overlayManager: OverlayManager
  proxyManager: ProxyManager
  storageManager: StorageManager
  historyManager: HistoryManager
  contentFilterManager: ContentFilterManager
  paymentInterceptor: PaymentInterceptor
}

export function initTabManager(win: BrowserWindow, port: number, deps?: TabManagerDeps): void {
  if (resizeHandler && mainWindow) {
    mainWindow.off('resize', resizeHandler)
  }

  mainWindow = win
  proxyPort = port

  // Wire up sub-module dependencies if provided
  if (deps) {
    _overlayManager = deps.overlayManager
    setTabEventDeps({
      historyManager: deps.historyManager,
      overlayManager: deps.overlayManager,
    })
    setSessionDeps({
      contentFilterManager: deps.contentFilterManager,
      paymentInterceptor: deps.paymentInterceptor,
    })
    setTabStorageManager(deps.storageManager)
  }

  initCookieAutoDelete()

  // Initialize storage listener (dispose previous if re-initializing)
  storageListenerDisposable?.dispose()
  if (deps) {
    storageListenerDisposable = initStorageListener(deps.proxyManager)
  }

  resizeHandler = () => {
    const activeView = getActiveView()
    if (mainWindow && activeView) {
      updateViewBounds(activeView, mainWindow, currentWalletSidebarWidth)
    }
  }

  mainWindow.on('resize', resizeHandler)
}

function setupViewEvents(view: WebContentsView, tabId: string): void {
  const store = new DisposableStore()
  store.add(setupViewEventListeners(view, tabId))
  store.add(setupSecurityHandlers(view, tabId))
  store.add(setupNavAwareAttach(view, tabId))
  viewDisposables.get(tabId)?.dispose()
  viewDisposables.set(tabId, store)
}

/**
 * Intercept Chromium-internal navigations (link clicks, redirects) to detach
 * the view before unload and reattach once the new page is painted.
 *
 * navigateInTab already handles address-bar / programmatic navigations via
 * attachViewWhenReady on fresh views, but link clicks stay in the same
 * webContents and would otherwise expose the view's paint-holding color
 * during the pre-paint gap on Linux (electron/electron#44652).
 */
function setupNavAwareAttach(view: WebContentsView, tabId: string): IDisposable {
  return onWebContents(
    view.webContents,
    'did-start-navigation',
    (_e: Electron.Event, url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (!isMainFrame || isInPlace) return
      if (!url || !(url.startsWith('http:') || url.startsWith('https:'))) return
      if (!mainWindow) return
      if (views.get(tabId) !== view) return
      if (activeViewId !== tabId) return
      try {
        if (mainWindow.contentView.children.includes(view)) {
          mainWindow.contentView.removeChildView(view)
          attachViewWhenReady(view, tabId)
        }
      } catch (err) {
        log.debug(`did-start-navigation detach failed for tab ${tabId}:`, err)
      }
    }
  )
}

export async function createTab(tabId: string, initialUrl?: string): Promise<boolean> {
  if (!mainWindow) return false
  if (views.has(tabId)) return false

  try {
    const domain = initialUrl ? extractDomain(initialUrl) : 'default'
    const session = await getSessionForDomain(domain, proxyPort)

    const view = createBrowserView(session)
    setupViewEvents(view, tabId)
    views.set(tabId, view)
    setTabDomain(tabId, domain)

    switchTab(tabId)

    return true
  } catch (error) {
    log.error(`Failed to create tab ${tabId}:`, error)
    views.delete(tabId)
    return false
  }
}

/**
 * Load a storage bag in an existing tab.
 * Delegates to tabs-storage module.
 */
export async function loadStorageBagInTab(tabId: string, bagId: string): Promise<void> {
  const view = views.get(tabId)
  if (!view) throw new Error(`View not found for tab ${tabId}`)

  await loadStorageBag(view, {
    bagId,
    label: bagId.slice(0, 16) + '.bag',
    timeout: 60,
    useCache: true,
    checkIndexHtml: true,
  })
}

export function closeTab(tabId: string): boolean {
  const view = views.get(tabId)
  if (!view) return false

  fileBrowserCache.delete(view.webContents.id)
  viewDisposables.get(tabId)?.dispose()
  viewDisposables.delete(tabId)

  if (mainWindow) {
    try {
      mainWindow.contentView.removeChildView(view)
    } catch {
      log.debug('View not attached during closeTab')
    }
  }

  cleanupDomainForTab(tabId)

  view.webContents.close()
  views.delete(tabId)

  if (activeViewId === tabId) {
    activeViewId = null
  }

  return true
}

export function switchTab(tabId: string): boolean {
  if (!mainWindow) return false
  _overlayManager?.hideAll()

  const view = views.get(tabId)
  if (!view) return false

  const currentView = activeViewId ? views.get(activeViewId) : null
  if (currentView) {
    try {
      mainWindow.contentView.removeChildView(currentView)
    } catch {
      log.debug('View not attached during switchTab')
    }
  }
  mainWindow.contentView.addChildView(view)
  updateViewBounds(view, mainWindow, currentWalletSidebarWidth)
  activeViewId = tabId

  return true
}

export function getActiveView(): WebContentsView | null {
  if (!activeViewId) return null
  return views.get(activeViewId) || null
}

export function getActiveTabId(): string | null {
  return activeViewId
}

export function hideAllViews(): void {
  if (!mainWindow) return
  _overlayManager?.hideAll()

  const activeView = activeViewId ? views.get(activeViewId) : null
  if (activeView) {
    try {
      mainWindow.contentView.removeChildView(activeView)
    } catch {
      log.debug('View not attached during hideAllViews')
    }
  }
}

export function showActiveView(): void {
  if (!mainWindow) return
  const view = getActiveView()
  if (view) {
    mainWindow.contentView.addChildView(view)
    updateViewBounds(view, mainWindow, currentWalletSidebarWidth)
  }
}

/**
 * Clean up all tab state on app exit.
 * Closes all WebContentsViews, disposes listeners, removes resize handler.
 */
export function cleanupTabManager(): void {
  hideAllViews()

  for (const [tabId, view] of views) {
    viewDisposables.get(tabId)?.dispose()
    if (mainWindow) {
      try {
        mainWindow.contentView.removeChildView(view)
      } catch {
        // View may not be attached
      }
    }
    view.webContents.close()
  }
  views.clear()
  viewDisposables.clear()

  storageListenerDisposable?.dispose()
  storageListenerDisposable = null

  if (resizeHandler && mainWindow) {
    mainWindow.off('resize', resizeHandler)
  }
  resizeHandler = null
  activeViewId = null
  currentWalletSidebarWidth = 0
  mainWindow = null
  _overlayManager = null
}

// Deferred-attach window sizing.
// Floor: prevents a Lottie flash on pages that paint in <150ms (cache, local).
// Ceiling: guarantees the view attaches even if dom-ready never fires.
const DEFERRED_ATTACH_MIN_HOLD_MS = 150
const DEFERRED_ATTACH_MAX_WAIT_MS = 5000

/**
 * Attach a newly created WebContentsView only once its content is ready to paint.
 *
 * Pattern borrowed from Min Browser / Wexond. While we wait, the renderer React
 * layer below stays visible and renders the loading state (App.tsx external-page
 * branch: Lottie on bg-background-secondary). Once dom-ready (or a fallback)
 * fires, the now-painted view is attached and covers the renderer.
 *
 * Without this, on Linux the empty attached view exposes its paint-holding
 * color during the pre-paint gap (electron/electron#44652) — user sees black.
 */
function attachViewWhenReady(view: WebContentsView, tabId: string): void {
  if (!mainWindow) return
  const startedAt = Date.now()
  let decided = false

  const performAttach = (): void => {
    if (!mainWindow) return
    // A failed cold-start load can replace/tear down this view before the
    // deferred attach fires; bail before touching a stale/undefined webContents.
    if (views.get(tabId) !== view) return
    const wc = view.webContents
    if (!wc || wc.isDestroyed()) return
    if (activeViewId !== tabId) return
    try {
      if (!mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.addChildView(view)
        updateViewBounds(view, mainWindow, currentWalletSidebarWidth)
      }
    } catch (err) {
      log.debug(`Deferred attach failed for tab ${tabId}:`, err)
    }
  }

  const decide = (): void => {
    if (decided) return
    decided = true
    const elapsed = Date.now() - startedAt
    const delay = Math.max(0, DEFERRED_ATTACH_MIN_HOLD_MS - elapsed)
    if (delay === 0) {
      performAttach()
    } else {
      setTimeout(performAttach, delay)
    }
  }

  view.webContents.once('dom-ready', decide)
  view.webContents.once('did-fail-load', decide)
  setTimeout(decide, DEFERRED_ATTACH_MAX_WAIT_MS)
}

export async function navigateInTab(tabId: string, url: string): Promise<boolean> {
  const view = views.get(tabId)
  if (!view) return false

  let navigateUrl = url
  if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('ton://') &&
    !url.startsWith('tonsite://')
  ) {
    navigateUrl = `http://${url}`
  }

  navigateUrl = normalizeUrl(navigateUrl)

  try {
    const parsed = new URL(navigateUrl)
    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      log.error(`Blocked navigation to unsafe scheme: ${parsed.protocol}`)
      return false
    }
  } catch {
    log.error(`Invalid URL: ${navigateUrl}`)
    return false
  }

  const domain = extractDomain(navigateUrl)
  const currentDomain = getTabDomain(tabId)
  const isActive = activeViewId === tabId

  if (currentDomain && currentDomain !== domain) {
    log.info(`Domain changed: ${currentDomain} -> ${domain}, recreating view`)

    viewDisposables.get(tabId)?.dispose()
    viewDisposables.delete(tabId)
    if (mainWindow) {
      try {
        mainWindow.contentView.removeChildView(view)
      } catch {
        log.debug('View not attached during domain change')
      }
    }
    view.webContents.close()

    const newSession = await getSessionForDomain(domain, proxyPort)
    const newView = createBrowserView(newSession)
    setupViewEvents(newView, tabId)
    views.set(tabId, newView)
    setTabDomain(tabId, domain)
    updateDomainActivity(domain)

    emitToRenderer('tab:history-reset', tabId)

    if (isActive) {
      attachViewWhenReady(newView, tabId)
    }

    newView.webContents.loadURL(navigateUrl).catch((err) => {
      if (String(err).includes('ERR_ABORTED')) return
      log.error('loadURL failed (new view):', err)
      loadErrorPage(newView, err.message, navigateUrl)
    })
  } else {
    setTabDomain(tabId, domain)
    updateDomainActivity(domain)

    if (isActive && mainWindow) {
      try {
        mainWindow.contentView.removeChildView(view)
      } catch {
        log.debug('View not attached during same-domain navigate')
      }
      mainWindow.contentView.addChildView(view)
      updateViewBounds(view, mainWindow, currentWalletSidebarWidth)
    }

    view.webContents.loadURL(navigateUrl).catch((err) => {
      log.error('loadURL failed:', err)
      loadErrorPage(view, err.message, navigateUrl)
    })
  }

  return true
}

// Re-export getAllSessions from session module
export { getAllSessions } from './tabs-session'
