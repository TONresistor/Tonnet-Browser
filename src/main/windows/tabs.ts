/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages WebContentsViews.
 */

import { WebContentsView, BrowserWindow } from 'electron'
import { createBrowserView } from './browser-view'
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
  loadStorageBrowser,
  loadErrorPage,
  fileBrowserCache as _fileBrowserCache,
} from './tabs-storage'
import { updateViewBounds, updateSidebarBounds, invalidateAppearanceCache } from './tabs-bounds'
import { setupSecurityHandlers, ALLOWED_SCHEMES } from './tabs-security'
import { setupViewEventListeners } from './tabs-events'
import { overlayManager } from './overlay-manager'

// Re-export for backward compatibility (used by navigation.ts dynamic import)
export const fileBrowserCache = _fileBrowserCache
import { DEFAULT_PROXY_PORT } from '../../shared/constants'
import { createLogger } from '../../shared/logger'
import { emitToRenderer } from '../ipc/handlers/shared'
import { normalizeUrl } from '../../shared/utils/url'

const log = createLogger('tabs')

// Map of all WebContentsViews by tabId
const views = new Map<string, WebContentsView>()
let activeViewId: string | null = null
let mainWindow: BrowserWindow | null = null
let proxyPort = DEFAULT_PROXY_PORT

// Store resize handler reference to prevent listener accumulation on reconnect
let resizeHandler: (() => void) | null = null

let currentWalletSidebarWidth = 0

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

export function initTabManager(win: BrowserWindow, port: number): void {
  if (resizeHandler && mainWindow) {
    mainWindow.off('resize', resizeHandler)
  }

  mainWindow = win
  proxyPort = port

  initCookieAutoDelete()

  resizeHandler = () => {
    const activeView = getActiveView()
    if (mainWindow && activeView) {
      updateViewBounds(activeView, mainWindow, currentWalletSidebarWidth)
    }
  }

  mainWindow.on('resize', resizeHandler)
}

function setupViewEvents(view: WebContentsView, tabId: string): void {
  setupViewEventListeners(view, tabId)
  setupSecurityHandlers(view, tabId)
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
  view.webContents.removeAllListeners()

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
  overlayManager.hideAll()

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
  overlayManager.hideAll()

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
  } catch (err) {
    log.error(`Invalid URL: ${navigateUrl}`)
    return false
  }

  const domain = extractDomain(navigateUrl)
  const currentDomain = getTabDomain(tabId)
  const isActive = activeViewId === tabId

  if (currentDomain && currentDomain !== domain) {
    log.info(`Domain changed: ${currentDomain} -> ${domain}, recreating view`)

    view.webContents.removeAllListeners()
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

    if (isActive && mainWindow) {
      mainWindow.contentView.addChildView(newView)
      updateViewBounds(newView, mainWindow, currentWalletSidebarWidth)
    }

    emitToRenderer('tab:history-reset', tabId)

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
