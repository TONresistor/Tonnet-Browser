/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages WebContentsViews.
 */

import { resolve, sep } from 'path'
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

// Re-export for backward compatibility (used by navigation.ts dynamic import)
export const fileBrowserCache = _fileBrowserCache
import { UI_DIMENSIONS, DEFAULT_PROXY_PORT } from '../../shared/constants'
import { getSetting, type AppearanceSettings } from '../settings'
import { createLogger } from '../../shared/logger'
import { emitToRenderer } from '../ipc/handlers/shared'
import { historyManager } from '../history/manager'
import { normalizeUrl } from '../../shared/utils/url'
import { buildContextMenu } from '../utils/context-menu'
import { extractFavicon } from './browser-view'

const log = createLogger('tabs')

const { TABBAR_HEIGHT, NAVBAR_HEIGHT, BOOKMARKS_HEIGHT, STATUSBAR_HEIGHT, DEFAULT_SIDEBAR_WIDTH } = UI_DIMENSIONS

// Map of all WebContentsViews by tabId
const views = new Map<string, WebContentsView>()
let activeViewId: string | null = null
let mainWindow: BrowserWindow | null = null
let proxyPort = DEFAULT_PROXY_PORT

// Store resize handler reference to prevent listener accumulation on reconnect
let resizeHandler: (() => void) | null = null

let currentWalletSidebarWidth = 0

// Cache for appearance settings to avoid redundant getSetting() calls during resize
interface AppearanceCache {
  showBookmarksBar: boolean
  isVertical: boolean
  timestamp: number
}
let appearanceCache: AppearanceCache | null = null
const CACHE_VALIDITY_MS = 500

// Re-export for settings.ts
export function onPrivacySettingsChanged(): void {
  sessionPrivacyChanged()
}

// Update view bounds when appearance settings change (called from IPC handlers)
export function onAppearanceSettingsChanged(): void {
  appearanceCache = null
  const activeView = getActiveView()
  if (activeView) {
    updateViewBounds(activeView)
  }
}

// Get cached appearance settings or refresh cache
function getAppearanceSettings(): AppearanceCache {
  const now = Date.now()

  if (appearanceCache && now - appearanceCache.timestamp < CACHE_VALIDITY_MS) {
    return appearanceCache
  }

  const appearance: AppearanceSettings = getSetting('appearance')
  appearanceCache = {
    showBookmarksBar: appearance.showBookmarksBar ?? false,
    isVertical: appearance.tabOrientation === 'vertical',
    timestamp: now,
  }

  return appearanceCache
}

// Immediate sidebar width update (for real-time resize without settings persistence)
export function updateSidebarWidth(width: number): void {
  const activeView = getActiveView()
  if (!activeView || !mainWindow) return

  const bounds = mainWindow.getContentBounds()
  const { isVertical, showBookmarksBar } = getAppearanceSettings()

  if (!isVertical) return

  let chromeHeight = NAVBAR_HEIGHT
  if (showBookmarksBar) {
    chromeHeight += BOOKMARKS_HEIGHT
  }

  activeView.setBounds({
    x: width,
    y: chromeHeight,
    width: bounds.width - width,
    height: bounds.height - chromeHeight - STATUSBAR_HEIGHT,
  })
}

export function updateWalletSidebarWidth(width: number): void {
  currentWalletSidebarWidth = width
  if (!mainWindow) return
  for (const view of mainWindow.contentView.children) {
    if (view instanceof WebContentsView) {
      updateViewBounds(view as WebContentsView)
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
      updateViewBounds(activeView)
    }
  }

  mainWindow.on('resize', resizeHandler)
}

function updateViewBounds(view: WebContentsView): void {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()

  const appearance: AppearanceSettings = getSetting('appearance')
  const isVertical = appearance.tabOrientation === 'vertical'
  const sidebarWidth = appearance.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
  const showBookmarksBar = appearance.showBookmarksBar ?? false

  let chromeHeight = NAVBAR_HEIGHT
  if (!isVertical) {
    chromeHeight += TABBAR_HEIGHT
  }
  if (showBookmarksBar) {
    chromeHeight += BOOKMARKS_HEIGHT
  }

  const x = isVertical ? sidebarWidth : 0
  const width = (isVertical ? bounds.width - sidebarWidth : bounds.width) - currentWalletSidebarWidth

  view.setBounds({
    x,
    y: chromeHeight,
    width,
    height: bounds.height - chromeHeight - STATUSBAR_HEIGHT,
  })
}

// Allowed URL schemes for security
const ALLOWED_SCHEMES = ['http:']

function setupViewEvents(view: WebContentsView, tabId: string): void {
  view.webContents.on('did-start-loading', () => {
    emitToRenderer('page:loading', true, tabId)
  })

  view.webContents.on('did-stop-loading', () => {
    emitToRenderer('page:loading', false, tabId)
  })

  view.webContents.on('did-navigate', (_e, url) => {
    emitToRenderer('page:navigate', {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })

    const title = view.webContents.getTitle()
    historyManager.addEntry(url, title)
  })

  view.webContents.on('did-navigate-in-page', (_e, url) => {
    emitToRenderer('page:navigate', {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })

    const title = view.webContents.getTitle()
    historyManager.addEntry(url, title)
  })

  view.webContents.on('page-title-updated', (_e, title) => {
    emitToRenderer('page:title', title, tabId)

    const url = view.webContents.getURL()
    historyManager.addEntry(url, title, undefined, false)
  })

  // Extract favicon and detect empty storage bag pages
  view.webContents.on('did-finish-load', async () => {
    try {
      const favicon = await extractFavicon(view)
      if (favicon) {
        emitToRenderer('page:favicon', favicon, tabId)
      }
    } catch (error) {
      log.debug(`Failed to extract favicon for tab ${tabId}:`, error)
    }

    try {
      const pageUrl = view.webContents.getURL()
      const url = new URL(pageUrl)
      if (url.hostname.endsWith('.ton') && !pageUrl.startsWith('data:')) {
        const bodyText = await view.webContents.executeJavaScript('document.body ? document.body.innerText.trim() : ""')
        const bodyHtml = await view.webContents.executeJavaScript('document.body ? document.body.innerHTML.trim() : ""')
        if (bodyHtml.length < 50 && bodyText.length < 10) {
          log.info(`Empty page detected for ${url.hostname}, trying storage browser`)
          loadStorageBrowser(view, url.hostname).catch(() => {
            log.debug('Not a storage bag or no files available')
          })
        }
      }
    } catch (err) {
      log.debug('Empty page detection failed:', err)
    }
  })

  // Handle load failures
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3 || errorCode === -2 || errorCode === 0) {
      return
    }

    if (validatedURL.startsWith('data:') || validatedURL.startsWith('file:')) {
      return
    }

    log.warn(`Page load failed: ${errorDescription} (code: ${errorCode}) for ${validatedURL}`)

    try {
      const url = new URL(validatedURL)
      if (url.hostname.endsWith('.ton')) {
        loadStorageBrowser(view, url.hostname).catch(() => {
          loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
        })
        return
      }
    } catch (err) {
      log.debug('URL parse failed in did-fail-load:', err)
    }

    loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
  })

  // Security: Intercept navigation to validate URLs
  view.webContents.on('will-navigate', (event, url) => {
    // Handle bagfile:// links from file browser
    if (url.startsWith('bagfile://')) {
      event.preventDefault()
      const currentPageUrl = view.webContents.getURL()
      if (!currentPageUrl.startsWith('data:text/html')) {
        log.warn('Blocked bagfile:// from non-file-browser page')
        return
      }
      const withoutScheme = url.slice('bagfile://'.length)
      const slashIdx = withoutScheme.indexOf('/')
      if (slashIdx !== -1) {
        const bp = decodeURIComponent(withoutScheme.slice(0, slashIdx))
        const fp = decodeURIComponent(withoutScheme.slice(slashIdx + 1))
        const fullPath = resolve(`${bp}/${fp}`)
        const safeBp = resolve(bp)
        if (!fullPath.startsWith(safeBp + sep) && fullPath !== safeBp) {
          log.warn(`Blocked bagfile:// path traversal: ${fullPath}`)
          return
        }
        view.webContents
          .loadFile(fullPath)
          .then(() => {
            emitToRenderer('page:navigate', {
              tabId,
              url: `file://${fullPath}`,
              canGoBack: true,
              canGoForward: false,
            })
          })
          .catch((err) => {
            log.error(`Failed to load bag file: ${fullPath}`, err)
          })
      }
      return
    }

    try {
      const normalized = normalizeUrl(url)
      const parsed = new URL(normalized)

      if (normalized !== url) {
        event.preventDefault()
        log.debug(`Normalizing URL: ${url} -> ${normalized}`)
        view.webContents.loadURL(normalized).catch((err) => {
          log.error('loadURL failed (normalization):', err)
          loadErrorPage(view, err.message, normalized)
        })
        return
      }

      if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
        log.warn(`Blocked navigation to unsafe URL: ${url}`)
        event.preventDefault()
      }
    } catch (err) {
      log.debug('URL validation failed in will-navigate:', err)
      log.warn(`Blocked navigation to invalid URL: ${url}`)
      event.preventDefault()
    }
  })

  // Security: Control popup windows - open in new tab instead
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const targetUrl = normalizeUrl(url)
      const parsed = new URL(targetUrl)

      if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
        if (targetUrl !== url) {
          log.debug(`Normalizing popup URL: ${url} -> ${targetUrl}`)
        }
        emitToRenderer('context:open-link', targetUrl)
      } else {
        log.warn(`Blocked popup to unsafe URL: ${url}`)
      }
    } catch (err) {
      log.debug('URL validation failed in popup handler:', err)
      log.warn(`Blocked popup to invalid URL: ${url}`)
    }
    return { action: 'deny' }
  })

  // Fallback: Close any window that somehow gets created
  view.webContents.on('did-create-window', (childWindow, { url }) => {
    log.warn(`Unexpected child window created, closing and redirecting: ${url}`)
    childWindow.close()
    if (url && url !== 'about:blank') {
      try {
        const targetUrl = normalizeUrl(url)
        const parsed = new URL(targetUrl)

        if (parsed.protocol === 'http:') {
          emitToRenderer('context:open-link', targetUrl)
        }
      } catch {
        log.debug(`Invalid URL in child window: ${url}`)
      }
    }
  })

  // Context menu for web pages
  view.webContents.on('context-menu', (_e, params) => {
    buildContextMenu(params, {
      webContents: view.webContents,
      onOpenLink: (url) => emitToRenderer('context:open-link', url),
      onNavigateBack: () => view.webContents.navigationHistory.goBack(),
      onNavigateForward: () => view.webContents.navigationHistory.goForward(),
      onReload: () => view.webContents.reload(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })
  })
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
  updateViewBounds(view)
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
    const currentView = activeViewId ? views.get(activeViewId) : null
    if (currentView) {
      try {
        mainWindow.contentView.removeChildView(currentView)
      } catch {
        log.debug('View not attached during showActiveView')
      }
    }
    mainWindow.contentView.addChildView(view)
    updateViewBounds(view)
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
      updateViewBounds(newView)
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
      updateViewBounds(view)
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
