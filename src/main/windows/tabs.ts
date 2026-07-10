/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages WebContentsViews.
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { createBrowserView } from './browser-view'
import { extractDomain, TabSessionManager } from './tabs-session'
import {
  loadStorageBag,
  loadErrorPage,
  createTabStorageState,
  disposeTabStorageState,
  initStorageListener,
  resolveBagFilePath,
} from './tabs-storage'
import { updateViewBounds, updateSidebarBounds, invalidateAppearanceCache } from './tabs-bounds'
import { setupSecurityHandlers, ALLOWED_SCHEMES } from './tabs-security'
import { setupViewEventListeners, type TabEventDeps } from './tabs-events'
import { DisposableStore, IDisposable, onWebContents } from '../utils/disposable'
import type { OverlayManager } from './overlay-manager'
import type { ProxyManager } from '../proxy/manager'
import type { StorageManager } from '../storage/daemon'
import type { HistoryManager } from '../history/manager'
import type { ContentFilterManager } from '../content-filter/filter-manager'
import type { PaymentInterceptor } from '../wallet/payment-interceptor'

import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { createLogger } from '../../shared/logger'
import { emitContractToRenderer } from '../events/renderer-events'
import { normalizeUrl } from '../../shared/utils/url'
import { tabHistoryResetContract } from '../../shared/ipc-contract/browsing'
import { ViewRegistry } from './view-registry'

const log = createLogger('tabs')

/** Owns every mutable resource in the main-process browsing lifecycle. */
export class TabManager {
  readonly sessions = new TabSessionManager()
  readonly storage = createTabStorageState()
  readonly views = new ViewRegistry<WebContentsView>()
  private mainWindow: BrowserWindow | null = null
  private proxyPort: number = DEFAULT_SETTINGS.proxyPort
  private resizeHandler: (() => void) | null = null
  private storageListenerDisposable: IDisposable | null = null
  private tabEventDeps: TabEventDeps | null = null
  private walletSidebarWidth = 0
  private overlayManager: OverlayManager | null = null

  get window(): BrowserWindow | null {
    return this.mainWindow
  }

  get port(): number {
    return this.proxyPort
  }

  get sidebarWidth(): number {
    return this.walletSidebarWidth
  }

  get overlay(): OverlayManager | null {
    return this.overlayManager
  }

  get eventDependencies(): TabEventDeps {
    if (!this.tabEventDeps) throw new Error('Tab manager event dependencies are not initialized.')
    return this.tabEventDeps
  }

  initialize(win: BrowserWindow, port: number, deps: TabManagerDeps): void {
    this.detachResizeHandler()
    this.mainWindow = win
    this.proxyPort = port

    this.overlayManager = deps.overlayManager
    this.tabEventDeps = {
      historyManager: deps.historyManager,
      overlayManager: deps.overlayManager,
      storage: this.storage,
    }
    this.sessions.initialize({
      contentFilterManager: deps.contentFilterManager,
      paymentInterceptor: deps.paymentInterceptor,
    })
    this.storage.storageManager = deps.storageManager

    this.storageListenerDisposable?.dispose()
    this.storageListenerDisposable = initStorageListener(this.storage, deps.proxyManager)
    this.resizeHandler = () => {
      const activeView = this.views.getActive()
      if (this.mainWindow && activeView) {
        updateViewBounds(activeView, this.mainWindow, this.walletSidebarWidth)
      }
    }
    this.mainWindow.on('resize', this.resizeHandler)
  }

  updateSidebarWidth(width: number): void {
    const activeView = this.getActiveView()
    if (!activeView || !this.mainWindow) return
    updateSidebarBounds(activeView, this.mainWindow, width)
  }

  updateWalletSidebarWidth(width: number): void {
    this.walletSidebarWidth = width
    if (!this.mainWindow) return
    for (const view of this.mainWindow.contentView.children) {
      if (view instanceof WebContentsView) updateViewBounds(view, this.mainWindow, this.walletSidebarWidth)
    }
  }

  onAppearanceSettingsChanged(): void {
    invalidateAppearanceCache()
    const activeView = this.getActiveView()
    if (activeView && this.mainWindow) updateViewBounds(activeView, this.mainWindow, this.walletSidebarWidth)
  }

  createTab(tabId: string, initialUrl?: string): Promise<boolean> {
    return createTabFor(this, tabId, initialUrl)
  }

  closeTab(tabId: string): boolean {
    return closeTabFor(this, tabId)
  }

  switchTab(tabId: string): boolean {
    return switchTabFor(this, tabId)
  }

  getActiveView(): WebContentsView | null {
    return this.views.getActive()
  }

  getActiveTabId(): string | null {
    return this.views.activeViewId
  }

  hideAllViews(): void {
    hideAllViewsFor(this)
  }

  showActiveView(): void {
    showActiveViewFor(this)
  }

  navigateInTab(tabId: string, url: string): Promise<boolean> {
    return navigateInTabFor(this, tabId, url)
  }

  loadStorageBag(tabId: string, bagId: string): Promise<void> {
    return loadStorageBagFor(this, tabId, bagId)
  }

  loadBagFile(tabId: string, bagId: string, relativePath: string): Promise<void> {
    return loadBagFileFor(this, tabId, bagId, relativePath)
  }

  dispose(): void {
    cleanupTabManagerFor(this)
  }

  disposeLifecycle(): void {
    this.storageListenerDisposable?.dispose()
    this.storageListenerDisposable = null
    this.detachResizeHandler()
    this.walletSidebarWidth = 0
    this.mainWindow = null
    this.overlayManager = null
    this.tabEventDeps = null
    this.sessions.dispose()
    disposeTabStorageState(this.storage)
  }

  private detachResizeHandler(): void {
    if (this.resizeHandler && this.mainWindow) this.mainWindow.off('resize', this.resizeHandler)
    this.resizeHandler = null
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

function setupViewEvents(manager: TabManager, view: WebContentsView, tabId: string): void {
  const store = new DisposableStore()
  store.add(setupViewEventListeners(view, tabId, manager.eventDependencies))
  store.add(setupSecurityHandlers(view, tabId))
  store.add(setupNavAwareAttach(manager, view, tabId))
  if (manager.views.has(tabId)) manager.views.replace(tabId, view, store)
  else manager.views.add(tabId, view, store)
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
function setupNavAwareAttach(manager: TabManager, view: WebContentsView, tabId: string): IDisposable {
  return onWebContents(
    view.webContents,
    'did-start-navigation',
    (_e: Electron.Event, url: string, isInPlace: boolean, isMainFrame: boolean) => {
      if (!isMainFrame || isInPlace) return
      if (!url || !(url.startsWith('http:') || url.startsWith('https:'))) return
      if (!manager.window) return
      if (manager.views.get(tabId) !== view) return
      if (manager.views.activeViewId !== tabId) return
      try {
        if (manager.window.contentView.children.includes(view)) {
          manager.window.contentView.removeChildView(view)
          attachViewWhenReady(manager, view, tabId)
        }
      } catch (err) {
        log.debug(`did-start-navigation detach failed for tab ${tabId}:`, err)
      }
    }
  )
}

async function createTabFor(manager: TabManager, tabId: string, initialUrl?: string): Promise<boolean> {
  if (!manager.window) return false
  if (manager.views.has(tabId)) return false

  try {
    const domain = initialUrl ? extractDomain(initialUrl) : 'default'
    const session = await manager.sessions.getSessionForDomain(domain, manager.port)

    const view = createBrowserView(session)
    setupViewEvents(manager, view, tabId)
    manager.sessions.setTabDomain(tabId, domain)

    manager.switchTab(tabId)

    return true
  } catch (error) {
    log.error(`Failed to create tab ${tabId}:`, error)
    manager.views.remove(tabId)
    return false
  }
}

/**
 * Load a storage bag in an existing tab.
 * Delegates to tabs-storage module.
 */
async function loadStorageBagFor(manager: TabManager, tabId: string, bagId: string): Promise<void> {
  const view = manager.views.get(tabId)
  if (!view) throw new Error(`View not found for tab ${tabId}`)

  await loadStorageBag(manager.storage, view, {
    bagId,
    label: bagId.slice(0, 16) + '.bag',
    timeout: 60,
    useCache: true,
    checkIndexHtml: true,
  })
}

/**
 * Open a single file from a bag inline in a tab (audio/pdf/image render in the
 * browser). The path is resolved + traversal-checked in tabs-storage.
 */
async function loadBagFileFor(manager: TabManager, tabId: string, bagId: string, relPath: string): Promise<void> {
  const view = manager.views.get(tabId)
  if (!view) throw new Error(`View not found for tab ${tabId}`)
  const fullPath = await resolveBagFilePath(manager.storage, bagId, relPath)
  await view.webContents.loadFile(fullPath)
  // A prior internal ton:// page may have detached all views (hideAllViews),
  // so re-attach if this is the active tab — otherwise the file loads into a
  // hidden view and the tab shows blank.
  if (tabId === manager.getActiveTabId()) manager.showActiveView()
}

/**
 * Detach a view from the main window's content view, tolerating an
 * already-detached view (Electron throws if it was never attached).
 * Passing `context` emits a debug log on failure; omit it to stay silent.
 */
function safeDetach(manager: TabManager, view: WebContentsView, context?: string): void {
  if (!manager.window) return
  try {
    manager.window.contentView.removeChildView(view)
  } catch {
    if (context) log.debug(`View not attached during ${context}`)
  }
}

function closeTabFor(manager: TabManager, tabId: string): boolean {
  const view = manager.views.get(tabId)
  if (!view) return false

  manager.storage.fileBrowserCache.delete(view.webContents.id)

  safeDetach(manager, view, 'closeTab')

  manager.sessions.cleanupDomainForTab(tabId)

  view.webContents.close()
  manager.views.remove(tabId)

  return true
}

function switchTabFor(manager: TabManager, tabId: string): boolean {
  if (!manager.window) return false
  manager.overlay?.hideAll()

  const view = manager.views.get(tabId)
  if (!view) return false

  const currentView = manager.views.getActive()
  if (currentView) {
    safeDetach(manager, currentView, 'switchTab')
  }
  manager.window.contentView.addChildView(view)
  updateViewBounds(view, manager.window, manager.sidebarWidth)
  manager.views.activate(tabId)

  return true
}

function hideAllViewsFor(manager: TabManager): void {
  if (!manager.window) return
  manager.overlay?.hideAll()

  const activeView = manager.views.getActive()
  if (activeView) {
    safeDetach(manager, activeView, 'hideAllViews')
  }
}

function showActiveViewFor(manager: TabManager): void {
  if (!manager.window) return
  const view = manager.getActiveView()
  if (view) {
    manager.window.contentView.addChildView(view)
    updateViewBounds(view, manager.window, manager.sidebarWidth)
  }
}

/**
 * Clean up all tab state on app exit.
 * Closes all WebContentsViews, disposes listeners, removes resize handler.
 */
function cleanupTabManagerFor(manager: TabManager): void {
  manager.hideAllViews()

  for (const [, { view }] of manager.views.entries()) {
    safeDetach(manager, view)
    view.webContents.close()
  }
  manager.views.clear()
  manager.disposeLifecycle()
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
function attachViewWhenReady(manager: TabManager, view: WebContentsView, tabId: string): void {
  if (!manager.window) return
  const startedAt = Date.now()
  let decided = false

  const performAttach = (): void => {
    if (!manager.window) return
    // A failed cold-start load can replace/tear down this view before the
    // deferred attach fires; bail before touching a stale/undefined webContents.
    if (manager.views.get(tabId) !== view) return
    const wc = view.webContents
    if (!wc || wc.isDestroyed()) return
    if (manager.views.activeViewId !== tabId) return
    try {
      if (!manager.window.contentView.children.includes(view)) {
        manager.window.contentView.addChildView(view)
        updateViewBounds(view, manager.window, manager.sidebarWidth)
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

async function navigateInTabFor(manager: TabManager, tabId: string, url: string): Promise<boolean> {
  const view = manager.views.get(tabId)
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
  const currentDomain = manager.sessions.getTabDomain(tabId)
  const isActive = manager.views.activeViewId === tabId

  if (currentDomain && currentDomain !== domain) {
    log.info(`Domain changed: ${currentDomain} -> ${domain}, recreating view`)

    safeDetach(manager, view, 'domain change')
    view.webContents.close()

    const newSession = await manager.sessions.getSessionForDomain(domain, manager.port)
    const newView = createBrowserView(newSession)
    setupViewEvents(manager, newView, tabId)
    manager.sessions.setTabDomain(tabId, domain)
    manager.sessions.updateDomainActivity(domain)

    emitContractToRenderer(tabHistoryResetContract, tabId)

    if (isActive) {
      attachViewWhenReady(manager, newView, tabId)
    }

    newView.webContents.loadURL(navigateUrl).catch((err) => {
      if (String(err).includes('ERR_ABORTED')) return
      log.error('loadURL failed (new view):', err)
      loadErrorPage(newView, err.message, navigateUrl)
    })
  } else {
    manager.sessions.setTabDomain(tabId, domain)
    manager.sessions.updateDomainActivity(domain)

    if (isActive && manager.window) {
      safeDetach(manager, view, 'same-domain navigate')
      manager.window.contentView.addChildView(view)
      updateViewBounds(view, manager.window, manager.sidebarWidth)
    }

    view.webContents.loadURL(navigateUrl).catch((err) => {
      log.error('loadURL failed:', err)
      loadErrorPage(view, err.message, navigateUrl)
    })
  }

  return true
}
