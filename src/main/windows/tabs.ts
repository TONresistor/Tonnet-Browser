/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages WebContentsViews.
 */

import { resolve, sep } from 'path'
import { WebContentsView, BrowserWindow } from 'electron'
import { createTonSession, createBrowserView, extractFavicon } from './browser-view'
import { generateFileBrowserPage, generateLoadingPage } from './file-browser'
import { DEFAULT_PROXY_PORT } from '../../shared/constants'
import { getSetting, type PrivacySettings, type AppearanceSettings } from '../settings'
import { createLogger } from '../../shared/logger'
const log = createLogger('tabs')
import { historyManager } from '../history/manager'
import { normalizeUrl } from '../../shared/utils/url'
import { buildContextMenu } from '../utils/context-menu'
import { storageManager } from '../storage/daemon'
import { proxyManager } from '../proxy/manager'
import type { BagDetails } from '../../shared/types'

/** Cache of bag IDs detected by the proxy for .ton storage domains */
const storageBagCache = new Map<string, string>()

/** Prevent concurrent loadStorageBrowser calls per webContents */
const storageBrowserLoading = new Set<number>()

/** Cache file browser HTML per webContentsId for back navigation */
export const fileBrowserCache = new Map<number, string>()

proxyManager.on('storage-bag-detected', ({ bagId, domain }: { bagId: string; domain: string }) => {
  storageBagCache.set(domain, bagId)
})

// Chrome component heights
const TABBAR_HEIGHT = 44
const NAVBAR_HEIGHT = 46
const BOOKMARKS_HEIGHT = 44
const STATUSBAR_HEIGHT = 24
const DEFAULT_SIDEBAR_WIDTH = 240 // Default sidebar width

// Map of all WebContentsViews by tabId
const views = new Map<string, WebContentsView>()
// Map of sessions by domain (for first-party isolation)
const domainSessions = new Map<string, Electron.Session>()
// Map of tab IDs to their current domain
const tabDomains = new Map<string, string>()
// Map of domain to last activity timestamp (for cookie auto-delete)
const domainActivity = new Map<string, number>()
let activeViewId: string | null = null
let mainWindow: BrowserWindow | null = null
let proxyPort = DEFAULT_PROXY_PORT
let tonSession: Electron.Session | null = null
let cookieAutoDeleteTimer: NodeJS.Timeout | null = null

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
const CACHE_VALIDITY_MS = 500 // Cache valid for 500ms (optimized for resize performance)

// Extract domain from URL for first-party isolation
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return 'default'
  }
}

// Update activity timestamp for a domain
function updateDomainActivity(domain: string): void {
  domainActivity.set(domain, Date.now())

  // Restart cookie auto-delete timer if not already running (handles idle→active transition)
  const privacy: PrivacySettings = getSetting('privacy')
  const cookieAutoDelete = privacy.cookieAutoDelete ?? false
  if (cookieAutoDelete && !cookieAutoDeleteTimer) {
    startCookieAutoDeleteTimer()
  }
}

// Cookie auto-delete: Check for inactive domains and clear their cookies
async function checkInactiveDomains(): Promise<void> {
  const privacy: PrivacySettings = getSetting('privacy')
  const cookieAutoDelete = privacy.cookieAutoDelete ?? false
  const cookieAutoDeleteMinutes = privacy.cookieAutoDeleteMinutes ?? 30

  if (!cookieAutoDelete) return

  const now = Date.now()
  const inactiveThreshold = cookieAutoDeleteMinutes * 60 * 1000 // Convert minutes to ms

  // Get domains that are currently in use (have open tabs)
  const activeDomains = new Set(tabDomains.values())

  // Check each domain for inactivity
  for (const [domain, lastActivity] of domainActivity.entries()) {
    // Skip if domain has active tabs
    if (activeDomains.has(domain)) continue

    // Check if domain is inactive
    if (now - lastActivity > inactiveThreshold) {
      const session = domainSessions.get(domain)
      if (session) {
        log.info(`Auto-deleting cookies for inactive domain: ${domain}`)
        try {
          await session.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
          })
          domainActivity.delete(domain)
          domainSessions.delete(domain)
        } catch (error) {
          log.error(`Failed to clear storage for ${domain}:`, error)
        }
      }
    }
  }

  // Stop timer if no more domains to monitor (optimization: prevent idle CPU usage)
  if (domainActivity.size === 0 && cookieAutoDeleteTimer) {
    clearInterval(cookieAutoDeleteTimer)
    cookieAutoDeleteTimer = null
    log.debug('Cookie auto-delete timer stopped (no domains to monitor)')
  }
}

// Start cookie auto-delete timer
function startCookieAutoDeleteTimer(): void {
  if (cookieAutoDeleteTimer) {
    clearInterval(cookieAutoDeleteTimer)
  }

  const privacy: PrivacySettings = getSetting('privacy')
  const cookieAutoDelete = privacy.cookieAutoDelete ?? false

  if (!cookieAutoDelete) return

  // Only run timer if there are domains with activity (optimization: prevent idle CPU usage)
  if (domainActivity.size === 0) return

  // Check every minute
  cookieAutoDeleteTimer = setInterval(() => {
    checkInactiveDomains().catch((error) => {
      log.error('Cookie auto-delete check failed:', error)
    })
  }, 60000)
}

// Restart timer when settings change (called from IPC handlers)
export function onPrivacySettingsChanged(): void {
  startCookieAutoDeleteTimer()
}

// Update view bounds when appearance settings change (called from IPC handlers)
export function onAppearanceSettingsChanged(): void {
  // Invalidate cache when settings change
  appearanceCache = null
  const activeView = getActiveView()
  if (activeView) {
    updateViewBounds(activeView)
  }
}

// Get cached appearance settings or refresh cache
function getAppearanceSettings(): AppearanceCache {
  const now = Date.now()

  // Return cached value if still valid
  if (appearanceCache && now - appearanceCache.timestamp < CACHE_VALIDITY_MS) {
    return appearanceCache
  }

  // Refresh cache
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
  // This is called directly during resize drag for immediate visual feedback
  // Settings persistence is handled separately in the renderer
  const activeView = getActiveView()
  if (!activeView || !mainWindow) return

  const bounds = mainWindow.getContentBounds()
  const { isVertical, showBookmarksBar } = getAppearanceSettings()

  if (!isVertical) return // Only applies in vertical mode

  // Calculate chrome height dynamically
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
  // Recalculate bounds for all active views
  if (!mainWindow) return
  for (const view of mainWindow.contentView.children) {
    if (view instanceof WebContentsView) {
      updateViewBounds(view as WebContentsView)
    }
  }
}

// Get or create session for a domain (First-Party Isolation)
async function getSessionForDomain(domain: string): Promise<Electron.Session> {
  const privacy: PrivacySettings = getSetting('privacy')
  const firstPartyIsolation = privacy.firstPartyIsolation ?? true // Default: enabled

  if (!firstPartyIsolation) {
    // First-party isolation disabled - use shared session
    if (!tonSession) {
      tonSession = await createTonSession(proxyPort, 'persist:ton-browser')
    }
    return tonSession
  }

  // First-party isolation enabled - per-domain sessions
  if (domainSessions.has(domain)) {
    // Update activity for existing session
    updateDomainActivity(domain)
    return domainSessions.get(domain)!
  }

  // Create new session for this domain (await proxy setup)
  const partitionName = `persist:ton-domain-${domain}`
  const session = await createTonSession(proxyPort, partitionName)
  domainSessions.set(domain, session)
  updateDomainActivity(domain)

  log.debug(`Created isolated session for domain: ${domain}`)
  return session
}

export function initTabManager(win: BrowserWindow, port: number): void {
  // Remove old resize listener if it exists (prevents accumulation on reconnect)
  if (resizeHandler && mainWindow) {
    mainWindow.off('resize', resizeHandler)
  }

  mainWindow = win
  proxyPort = port

  // Start cookie auto-delete timer
  startCookieAutoDeleteTimer()

  // Create and store new resize handler
  resizeHandler = () => {
    const activeView = getActiveView()
    if (mainWindow && activeView) {
      updateViewBounds(activeView)
    }
  }

  // Handle window resize
  mainWindow.on('resize', resizeHandler)
}

function updateViewBounds(view: WebContentsView): void {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()

  // Get appearance settings
  const appearance: AppearanceSettings = getSetting('appearance')
  const isVertical = appearance.tabOrientation === 'vertical'
  const sidebarWidth = appearance.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
  const showBookmarksBar = appearance.showBookmarksBar ?? false

  // Calculate chrome height dynamically based on visible components
  let chromeHeight = NAVBAR_HEIGHT
  if (!isVertical) {
    chromeHeight += TABBAR_HEIGHT // Horizontal mode has tab bar row
  }
  if (showBookmarksBar) {
    chromeHeight += BOOKMARKS_HEIGHT // Add bookmarks bar if visible
  }

  // Calculate dimensions based on tab orientation
  const x = isVertical ? sidebarWidth : 0
  const width = (isVertical ? bounds.width - sidebarWidth : bounds.width) - currentWalletSidebarWidth

  // Use full available space
  // Anti-fingerprinting is handled by JavaScript injection (spoofs window dimensions)
  view.setBounds({
    x,
    y: chromeHeight,
    width,
    height: bounds.height - chromeHeight - STATUSBAR_HEIGHT,
  })
}

function setupViewEvents(view: WebContentsView, tabId: string): void {
  view.webContents.on('did-start-loading', () => {
    mainWindow?.webContents.send('page:loading', true, tabId)
  })

  view.webContents.on('did-stop-loading', () => {
    mainWindow?.webContents.send('page:loading', false, tabId)
  })

  view.webContents.on('did-navigate', (_e, url) => {
    mainWindow?.webContents.send('page:navigate', {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })

    // Add to history
    const title = view.webContents.getTitle()
    historyManager.addEntry(url, title)

    // Re-show file browser when navigating back to a .ton storage root
    try {
      const parsed = new URL(url)
      if (parsed.hostname.endsWith('.ton') && parsed.pathname === '/' && storageBagCache.has(parsed.hostname)) {
        loadStorageBrowser(view, parsed.hostname, url).catch(() => {})
      }
    } catch {
      /* ignore */
    }
  })

  view.webContents.on('did-navigate-in-page', (_e, url) => {
    mainWindow?.webContents.send('page:navigate', {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })

    // Update history for in-page navigation
    const title = view.webContents.getTitle()
    historyManager.addEntry(url, title)
  })

  view.webContents.on('page-title-updated', (_e, title) => {
    mainWindow?.webContents.send('page:title', title, tabId)

    // Update history title without incrementing visit count
    const url = view.webContents.getURL()
    historyManager.addEntry(url, title, undefined, false)
  })

  // Extract and send favicon when page finishes loading.
  // Also detect empty storage bag pages (proxy serves 200 with no index.html).
  view.webContents.on('did-finish-load', async () => {
    try {
      const favicon = await extractFavicon(view)
      if (favicon) {
        mainWindow?.webContents.send('page:favicon', favicon, tabId)
      }
    } catch (error) {
      log.debug(`Failed to extract favicon for tab ${tabId}:`, error)
    }

    // Check for empty .ton storage pages
    try {
      const pageUrl = view.webContents.getURL()
      const url = new URL(pageUrl)
      if (url.hostname.endsWith('.ton') && !pageUrl.startsWith('data:')) {
        const bodyText = await view.webContents.executeJavaScript('document.body ? document.body.innerText.trim() : ""')
        const bodyHtml = await view.webContents.executeJavaScript('document.body ? document.body.innerHTML.trim() : ""')
        if (bodyHtml.length < 50 && bodyText.length < 10) {
          log.info(`Empty page detected for ${url.hostname}, trying storage browser`)
          loadStorageBrowser(view, url.hostname, pageUrl).catch(() => {
            log.debug('Not a storage bag or no files available')
          })
        }
      }
    } catch {
      /* ignore */
    }
  })

  // Handle load failures (timeouts, DNS errors, connection refused, etc.)
  view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // Ignore aborted loads (user navigated away) and cached errors
    // -3 = ERR_ABORTED (user cancelled navigation)
    // -2 = ERR_FAILED (generic, often from cache)
    if (errorCode === -3 || errorCode === -2 || errorCode === 0) {
      return
    }

    // Don't show error page for data: or file: URLs (prevents infinite loops)
    if (validatedURL.startsWith('data:') || validatedURL.startsWith('file:')) {
      return
    }

    log.warn(`Page load failed: ${errorDescription} (code: ${errorCode}) for ${validatedURL}`)

    // Check if this is a .ton domain that may have a storage bag
    try {
      const url = new URL(validatedURL)
      if (url.hostname.endsWith('.ton')) {
        loadStorageBrowser(view, url.hostname, validatedURL).catch(() => {
          loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
        })
        return
      }
    } catch {
      /* not a valid URL, fall through */
    }

    loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
  })

  // Security: Intercept navigation to validate URLs (blocks javascript:, data:, file:, etc.)
  view.webContents.on('will-navigate', (event, url) => {
    // Handle bagfile:// links from file browser (load local storage files)
    if (url.startsWith('bagfile://')) {
      event.preventDefault()
      // Only allow from file browser data: URL pages
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
        // Path confinement: ensure resolved path stays within the base path
        if (!fullPath.startsWith(safeBp + sep) && fullPath !== safeBp) {
          log.warn(`Blocked bagfile:// path traversal: ${fullPath}`)
          return
        }
        view.webContents
          .loadFile(fullPath)
          .then(() => {
            // Notify renderer so it updates tab history and enables back button
            mainWindow?.webContents.send('page:navigate', {
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

      // If URL was normalized, redirect to normalized version
      if (normalized !== url) {
        event.preventDefault()
        log.debug(`Normalizing URL: ${url} → ${normalized}`)
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
    } catch {
      log.warn(`Blocked navigation to invalid URL: ${url}`)
      event.preventDefault()
    }
  })

  // Security: Control popup windows (window.open) - open in new tab instead
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const targetUrl = normalizeUrl(url)
      const parsed = new URL(targetUrl)

      if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
        // Open valid http:// URLs in new tab
        if (targetUrl !== url) {
          log.debug(`Normalizing popup URL: ${url} → ${targetUrl}`)
        }
        mainWindow?.webContents.send('context:open-link', targetUrl)
      } else {
        log.warn(`Blocked popup to unsafe URL: ${url}`)
      }
    } catch {
      log.warn(`Blocked popup to invalid URL: ${url}`)
    }
    return { action: 'deny' } // Never create popup windows
  })

  // Fallback: Close any window that somehow gets created (shouldn't happen with setWindowOpenHandler)
  view.webContents.on('did-create-window', (childWindow, { url }) => {
    log.warn(`Unexpected child window created, closing and redirecting: ${url}`)
    childWindow.close()
    // Open in new tab instead
    if (url && url !== 'about:blank') {
      try {
        const targetUrl = normalizeUrl(url)
        const parsed = new URL(targetUrl)

        if (parsed.protocol === 'http:') {
          mainWindow?.webContents.send('context:open-link', targetUrl)
        }
      } catch {
        // Invalid URL, ignore
      }
    }
  })

  // Context menu for web pages
  view.webContents.on('context-menu', (_e, params) => {
    buildContextMenu(params, {
      webContents: view.webContents,
      onOpenLink: (url) => mainWindow?.webContents.send('context:open-link', url),
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
    // Determine initial domain for session isolation
    const domain = initialUrl ? extractDomain(initialUrl) : 'default'
    const session = await getSessionForDomain(domain)

    const view = createBrowserView(session)
    setupViewEvents(view, tabId)
    views.set(tabId, view)
    tabDomains.set(tabId, domain)

    // Switch to the new tab
    switchTab(tabId)

    return true
  } catch (error) {
    log.error(`Failed to create tab ${tabId}:`, error)
    // Cleanup: Remove any partially created state
    views.delete(tabId)
    tabDomains.delete(tabId)
    return false
  }
}

/**
 * Load a storage bag in an existing tab. Shows loading page,
 * downloads bag if needed, then shows file browser or index.html.
 */
export async function loadStorageBagInTab(tabId: string, bagId: string): Promise<void> {
  const view = views.get(tabId)
  if (!view) throw new Error(`View not found for tab ${tabId}`)

  // Check cache first (for back navigation)
  const cached = fileBrowserCache.get(view.webContents.id)
  if (cached) {
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(cached)}`)
    return
  }

  // Show loading page immediately
  const loadingHtml = generateLoadingPage(bagId.slice(0, 16) + '.bag')
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`)

  // Ensure bag is in daemon
  let details: BagDetails | null = null
  try {
    details = await storageManager.getBagDetails(bagId)
  } catch {
    log.info(`Bag ${bagId} not in daemon, adding...`)
    await storageManager.addBag(bagId)
  }

  // Wait for files (up to 60s)
  if (!details || details.files.length === 0) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        details = await storageManager.getBagDetails(bagId)
        if (details.files.length > 0) break
      } catch {
        /* keep waiting */
      }
    }
  }

  if (!details || details.files.length === 0) {
    loadErrorPage(view, 'Bag has no files or download timed out', `${bagId}.bag`)
    return
  }

  const rawDirName = ((details as any).dir_name || '').replace(/\/$/, '')
  // Strip path traversal sequences and path separators for safety
  const dirName = rawDirName.replace(/\.\./g, '').replace(/[/\\]/g, '')
  const basePath = dirName ? `${details.path}/${dirName}` : details.path

  // If index.html exists, load as website
  if (details.files.some((f) => f.name === 'index.html')) {
    log.info(`Bag has index.html, loading as website`)
    await view.webContents.loadFile(`${basePath}/index.html`)
    return
  }

  // Show file browser
  const html = generateFileBrowserPage(details.description || bagId.slice(0, 16), bagId, details.files, '/', basePath)
  fileBrowserCache.set(view.webContents.id, html)
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

export function closeTab(tabId: string): boolean {
  const view = views.get(tabId)
  if (!view) return false

  // Clean up file browser cache for this tab
  fileBrowserCache.delete(view.webContents.id)

  // Remove all event listeners to prevent memory leaks
  view.webContents.removeAllListeners()

  // Remove from window
  if (mainWindow) {
    try {
      mainWindow.contentView.removeChildView(view)
    } catch {
      /* view may not be attached */
    }
  }

  // Remove tab's domain mapping and clean up session if no other tab uses it
  const domain = tabDomains.get(tabId)
  tabDomains.delete(tabId)
  if (domain) {
    const domainStillInUse = [...tabDomains.values()].includes(domain)
    if (!domainStillInUse) {
      domainSessions.delete(domain)
      domainActivity.delete(domain)
    }
  }

  // Destroy the view
  view.webContents.close()
  views.delete(tabId)

  // If this was the active tab, clear activeViewId
  if (activeViewId === tabId) {
    activeViewId = null
  }

  return true
}

export function switchTab(tabId: string): boolean {
  if (!mainWindow) return false

  const view = views.get(tabId)
  if (!view) return false

  // Remove current tab view before adding the new one
  const currentView = activeViewId ? views.get(activeViewId) : null
  if (currentView) {
    try {
      mainWindow.contentView.removeChildView(currentView)
    } catch {
      /* view may not be attached */
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

  // Remove the active tab view from the window
  const activeView = activeViewId ? views.get(activeViewId) : null
  if (activeView) {
    try {
      mainWindow.contentView.removeChildView(activeView)
    } catch {
      /* view may not be attached */
    }
  }
}

export function showActiveView(): void {
  if (!mainWindow) return
  const view = getActiveView()
  if (view) {
    // Remove current tab view if any, then add the active one
    const currentView = activeViewId ? views.get(activeViewId) : null
    if (currentView) {
      try {
        mainWindow.contentView.removeChildView(currentView)
      } catch {
        /* view may not be attached */
      }
    }
    mainWindow.contentView.addChildView(view)
    updateViewBounds(view)
  }
}

// Allowed URL schemes for security
// Only http: is allowed - TON proxy doesn't support HTTPS tunneling
// Security is handled by the TON network itself
const ALLOWED_SCHEMES = ['http:']

/**
 * Attempt to load a TON Storage file browser for a .ton domain.
 * Shows a loading page, resolves the DNS storage record, ensures the bag
 * is in the storage daemon, then renders a file browser.
 * Throws if no storage record or bag files are unavailable.
 */
async function loadStorageBrowser(view: WebContentsView, domain: string, _originalUrl: string): Promise<void> {
  // Guard: prevent concurrent calls for the same webContents
  const wcId = view.webContents.id
  if (storageBrowserLoading.has(wcId)) return
  storageBrowserLoading.add(wcId)

  try {
    return await loadStorageBrowserInner(view, domain)
  } finally {
    storageBrowserLoading.delete(wcId)
  }
}

async function loadStorageBrowserInner(view: WebContentsView, domain: string): Promise<void> {
  // Show loading page immediately
  const loadingHtml = generateLoadingPage(domain)
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`)

  // Get bag ID from proxy detection cache
  const bagId = storageBagCache.get(domain)
  if (!bagId) throw new Error('No storage bag detected for this domain')

  // Ensure bag is in the storage daemon
  let details: BagDetails | null = null
  try {
    details = await storageManager.getBagDetails(bagId)
  } catch {
    // Bag not in daemon yet, add it
    await storageManager.addBag(bagId)
  }

  // Wait for files to become available (bag header + file list must load)
  if (!details || details.files.length === 0) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        details = await storageManager.getBagDetails(bagId)
        if (details.files.length > 0) break
      } catch {
        /* keep waiting */
      }
    }
  }

  if (!details || details.files.length === 0) {
    throw new Error('Bag has no files or failed to load')
  }

  // Render file browser
  const rawDirName = ((details as any).dir_name || '').replace(/\/$/, '')
  // Strip path traversal sequences and path separators for safety
  const dirName = rawDirName.replace(/\.\./g, '').replace(/[/\\]/g, '')
  const basePath = dirName ? `${details.path}/${dirName}` : details.path
  const html = generateFileBrowserPage(domain, bagId, details.files, '/', basePath)
  fileBrowserCache.set(view.webContents.id, html)
  await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

// Build-time constants: lottie player + loading animation baked by electron-vite
declare const __LOTTIE_PLAYER_JS__: string
declare const __LOADING_ANIMATION_JSON__: object

/**
 * Loads error page in WebContentsView when navigation fails.
 * Uses inline data URL to avoid file path issues and infinite loops.
 * Lottie player and animation data are injected at build time via define.
 */
function loadErrorPage(view: WebContentsView, errorMessage: string, failedUrl: string): void {
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
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
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
      font-family: 'Inter', system-ui, sans-serif;
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

  view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).catch((err) => {
    log.error('Failed to load error page:', err)
  })
}

export async function navigateInTab(tabId: string, url: string): Promise<boolean> {
  const view = views.get(tabId)
  if (!view) return false

  // Auto-add http:// if no scheme provided
  let navigateUrl = url
  if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('ton://') &&
    !url.startsWith('tonsite://')
  ) {
    navigateUrl = `http://${url}`
  }

  // Normalize URL (tonsite:// → http://, https:// → http://)
  navigateUrl = normalizeUrl(navigateUrl)

  // Validate URL scheme for security (block data:, file:, javascript:, etc.)
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

  // Track domain for first-party isolation
  const domain = extractDomain(navigateUrl)
  const currentDomain = tabDomains.get(tabId)
  const isActive = activeViewId === tabId

  // If navigating to different domain, recreate view with new session
  if (currentDomain && currentDomain !== domain) {
    log.info(`Domain changed: ${currentDomain} -> ${domain}, recreating view`)

    // Remove old view
    view.webContents.removeAllListeners()
    if (mainWindow) {
      try {
        mainWindow.contentView.removeChildView(view)
      } catch {
        /* view may not be attached */
      }
    }
    view.webContents.close()

    // Create new view with new domain's session (await proxy setup)
    const newSession = await getSessionForDomain(domain)
    const newView = createBrowserView(newSession)
    setupViewEvents(newView, tabId)
    views.set(tabId, newView)
    tabDomains.set(tabId, domain)
    updateDomainActivity(domain)

    // Show new view if this is the active tab
    if (isActive && mainWindow) {
      mainWindow.contentView.addChildView(newView)
      updateViewBounds(newView)
    }

    // Notify renderer to reset tab history (WebContentsView recreated, history is gone)
    mainWindow?.webContents.send('tab:history-reset', tabId)

    // Navigate in new view (proxy is ready)
    newView.webContents.loadURL(navigateUrl).catch((err) => {
      // Ignore ERR_ABORTED: happens when storage browser replaces the loading URL
      if (String(err).includes('ERR_ABORTED')) return
      log.error('loadURL failed (new view):', err)
      loadErrorPage(newView, err.message, navigateUrl)
    })
  } else {
    // Same domain or first navigation
    tabDomains.set(tabId, domain)
    updateDomainActivity(domain)

    // Ensure view is visible (may have been hidden for ton:// pages)
    if (isActive && mainWindow) {
      try {
        mainWindow.contentView.removeChildView(view)
      } catch {
        /* view may not be attached */
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

// Export all sessions for cleanup (used by clearOnExit)
export function getAllSessions(): Electron.Session[] {
  const sessions: Electron.Session[] = []

  // Add shared session if exists
  if (tonSession) {
    sessions.push(tonSession)
  }

  // Add all domain-specific sessions
  domainSessions.forEach((session) => {
    sessions.push(session)
  })

  return sessions
}
