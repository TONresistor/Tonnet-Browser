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
import type { AppearanceSettings } from '../../shared/types'
import { setupSecurityHandlers, ALLOWED_SCHEMES } from './tabs-security'
import { setupViewEventListeners, type TabEventDeps } from './tabs-events'
import { DisposableStore, type IDisposable } from '../utils/disposable'
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
import { BrowserUrlSchema, tabHistoryResetContract } from '../../shared/ipc-contract/browsing'
import { ViewRegistry } from './view-registry'
import { attachViewWhenReady, setupNavAwareAttach } from './tabs-attach'

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
  private sessionsActive = false
  private windowGeneration = 0
  private proxyPortBarrier: Promise<void> = Promise.resolve()
  private proxyPortUpdate: { port: number; flight: Promise<void> } | null = null
  private synchronizedProxyPort: number | null = null
  private readonly pendingSessionCreations = new Set<Promise<Electron.Session>>()
  private readonly navigationEpochByTab = new Map<string, number>()

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

  attachWindow(win: BrowserWindow, port: number, deps: TabManagerDeps): void {
    this.detachWindow()
    this.windowGeneration += 1
    this.mainWindow = win
    this.proxyPort = port
    if (this.synchronizedProxyPort !== port) this.synchronizedProxyPort = null

    this.overlayManager = deps.overlayManager
    this.tabEventDeps = {
      historyManager: deps.historyManager,
      overlayManager: deps.overlayManager,
      storage: this.storage,
      cancelNavigation: (tabId) => this.cancelNavigation(tabId),
    }
    this.sessions.initialize({
      contentFilterManager: deps.contentFilterManager,
      paymentInterceptor: deps.paymentInterceptor,
    })
    this.sessionsActive = true
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

  captureWindowGeneration(): number {
    return this.windowGeneration
  }

  ownsWindowGeneration(generation: number): boolean {
    return this.mainWindow !== null && this.windowGeneration === generation
  }

  async getSessionForDomain(domain: string): Promise<Electron.Session> {
    while (true) {
      let barrier = this.proxyPortBarrier
      await barrier
      if (barrier !== this.proxyPortBarrier) continue
      const creation = this.sessions.getSessionForDomain(domain, this.proxyPort)
      this.pendingSessionCreations.add(creation)
      try {
        const session = await creation
        while (barrier !== this.proxyPortBarrier) {
          barrier = this.proxyPortBarrier
          await barrier
        }
        return session
      } finally {
        this.pendingSessionCreations.delete(creation)
      }
    }
  }

  updateProxyPort(port: number): Promise<void> {
    if (this.proxyPortUpdate?.port === port) return this.proxyPortUpdate.flight
    if (!this.proxyPortUpdate && this.synchronizedProxyPort === port) return this.proxyPortBarrier
    this.proxyPort = port
    this.synchronizedProxyPort = null
    const update = this.proxyPortBarrier
      .catch(() => undefined)
      .then(async () => {
        await Promise.allSettled([...this.pendingSessionCreations])
        await this.sessions.updateProxyPort(port)
        this.synchronizedProxyPort = port
      })
    this.proxyPortBarrier = update
    this.proxyPortUpdate = { port, flight: update }
    update.then(
      () => {
        if (this.proxyPortUpdate?.flight === update) this.proxyPortUpdate = null
      },
      () => {
        if (this.proxyPortUpdate?.flight === update) this.proxyPortUpdate = null
      }
    )
    return update
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

  onAppearanceSettingsChanged(settings?: AppearanceSettings): void {
    invalidateAppearanceCache()
    const activeView = this.getActiveView()
    if (activeView && this.mainWindow) updateViewBounds(activeView, this.mainWindow, this.walletSidebarWidth, settings)
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

  hideAllViews(tabId?: string): void {
    hideAllViewsFor(this, tabId)
  }

  showActiveView(): void {
    showActiveViewFor(this)
  }

  navigateInTab(tabId: string, url: string): Promise<boolean> {
    return navigateInTabFor(this, tabId, url)
  }

  beginNavigation(tabId: string): number {
    const epoch = (this.navigationEpochByTab.get(tabId) ?? 0) + 1
    this.navigationEpochByTab.set(tabId, epoch)
    return epoch
  }

  ownsNavigation(tabId: string, epoch: number): boolean {
    return this.navigationEpochByTab.get(tabId) === epoch
  }

  cancelNavigation(tabId: string): void {
    this.beginNavigation(tabId)
  }

  forgetNavigation(tabId?: string): void {
    if (tabId) this.navigationEpochByTab.delete(tabId)
    else this.navigationEpochByTab.clear()
  }

  loadStorageBag(tabId: string, bagId: string): Promise<void> {
    return loadStorageBagFor(this, tabId, bagId)
  }

  loadBagFile(tabId: string, bagId: string, relativePath: string): Promise<void> {
    return loadBagFileFor(this, tabId, bagId, relativePath)
  }

  dispose(): void {
    this.detachWindow()
    if (this.sessionsActive) {
      this.sessions.dispose()
      this.sessionsActive = false
    }
  }

  detachWindow(win?: BrowserWindow): void {
    if (!this.mainWindow || (win && this.mainWindow !== win)) return
    this.windowGeneration += 1
    cleanupTabViewsFor(this)
    this.storageListenerDisposable?.dispose()
    this.storageListenerDisposable = null
    this.detachResizeHandler()
    this.walletSidebarWidth = 0
    this.mainWindow = null
    this.overlayManager = null
    this.tabEventDeps = null
    this.sessions.detachWindow()
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
  try {
    store.add(setupViewEventListeners(view, tabId, manager.eventDependencies))
    store.add(
      setupSecurityHandlers(view, tabId, (url) => {
        if (manager.views.get(tabId) !== view) return true
        const currentDomain = manager.sessions.getTabDomain(tabId)
        if (!currentDomain) return false
        if (currentDomain === extractDomain(url)) {
          manager.cancelNavigation(tabId)
          return false
        }
        void manager.navigateInTab(tabId, url).catch((error) => log.error('Cross-domain navigation failed:', error))
        return true
      })
    )
    store.add(setupNavAwareAttach(manager, view, tabId))
    if (manager.views.has(tabId)) manager.views.replace(tabId, view, store)
    else manager.views.add(tabId, view, store)
  } catch (error) {
    store.dispose()
    throw error
  }
}

async function createTabFor(manager: TabManager, tabId: string, initialUrl?: string): Promise<boolean> {
  if (!manager.window) return false
  if (manager.views.has(tabId)) return false
  const generation = manager.captureWindowGeneration()
  let createdView: WebContentsView | null = null

  try {
    const domain = initialUrl ? extractDomain(initialUrl) : 'default'
    const session = await manager.getSessionForDomain(domain)
    if (!manager.ownsWindowGeneration(generation) || manager.views.has(tabId)) return false

    createdView = createBrowserView(session)
    setupViewEvents(manager, createdView, tabId)
    manager.sessions.setTabDomain(tabId, domain)

    if (!manager.switchTab(tabId)) {
      manager.views.remove(tabId)
      createdView.webContents.close()
      return false
    }

    return true
  } catch (error) {
    log.error(`Failed to create tab ${tabId}:`, error)
    if (createdView && manager.views.get(tabId) === createdView) manager.views.remove(tabId)
    if (createdView && !createdView.webContents.isDestroyed()) createdView.webContents.close()
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
  manager.cancelNavigation(tabId)

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
  manager.cancelNavigation(tabId)
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
  manager.forgetNavigation(tabId)

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

function hideAllViewsFor(manager: TabManager, tabId?: string): void {
  if (!manager.window) return
  const targetTabId = tabId ?? manager.views.activeViewId
  if (targetTabId) manager.cancelNavigation(targetTabId)
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

function cleanupTabViewsFor(manager: TabManager): void {
  manager.hideAllViews()

  for (const [, { view }] of manager.views.entries()) {
    safeDetach(manager, view)
    view.webContents.close()
  }
  manager.views.clear()
  manager.forgetNavigation()
}

async function navigateInTabFor(manager: TabManager, tabId: string, url: string): Promise<boolean> {
  const view = manager.views.get(tabId)
  if (!view) return false
  const generation = manager.captureWindowGeneration()

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

  if (!BrowserUrlSchema.safeParse(navigateUrl).success) {
    log.error('Invalid navigation URL')
    return false
  }

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

  const navigationEpoch = manager.beginNavigation(tabId)

  const domain = extractDomain(navigateUrl)
  const currentDomain = manager.sessions.getTabDomain(tabId)

  if (currentDomain && currentDomain !== domain) {
    log.debug('Domain changed, recreating view')

    let newSession: Electron.Session
    try {
      newSession = await manager.getSessionForDomain(domain)
    } catch (error) {
      log.error(`Failed to create session for ${domain}:`, error)
      return false
    }
    if (
      !manager.ownsWindowGeneration(generation) ||
      !manager.ownsNavigation(tabId, navigationEpoch) ||
      manager.views.get(tabId) !== view
    )
      return false

    let newView: WebContentsView | undefined
    try {
      newView = createBrowserView(newSession)
      setupViewEvents(manager, newView, tabId)
    } catch (error) {
      if (newView && !newView.webContents.isDestroyed()) newView.webContents.close()
      log.error(`Failed to create view for ${domain}:`, error)
      return false
    }
    safeDetach(manager, view, 'domain change')
    view.webContents.close()
    manager.sessions.setTabDomain(tabId, domain)
    manager.sessions.updateDomainActivity(domain)
    emitContractToRenderer(tabHistoryResetContract, tabId, navigateUrl)

    if (manager.views.activeViewId === tabId) {
      attachViewWhenReady(manager, newView, tabId, generation)
    }

    newView.webContents.loadURL(navigateUrl).catch((err) => {
      if (String(err).includes('ERR_ABORTED')) return
      log.error('loadURL failed (new view):', err)
      loadErrorPage(newView, err.message, navigateUrl)
    })
  } else {
    manager.sessions.setTabDomain(tabId, domain)
    manager.sessions.updateDomainActivity(domain)

    if (manager.views.activeViewId === tabId && manager.window) {
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
