/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages BrowserViews.
 */

import { BrowserView, BrowserWindow } from 'electron'
import { createTonSession, createBrowserView, extractFavicon } from './browser-view'
import { DEFAULT_PROXY_PORT } from '../../shared/constants'
import { getSetting, type PrivacySettings, type AppearanceSettings } from '../settings'
import { logger } from '../../shared/logger'
import { historyManager } from '../history/manager'
import { normalizeUrl } from '../../shared/utils/url'
import { buildContextMenu } from '../utils/context-menu'

// Chrome component heights
const TABBAR_HEIGHT = 44
const NAVBAR_HEIGHT = 46
const BOOKMARKS_HEIGHT = 40
const CHROME_BUFFER = 0 // No extra buffer needed
const STATUSBAR_HEIGHT = 24
const DEFAULT_SIDEBAR_WIDTH = 240 // Default sidebar width

// Map of all BrowserViews by tabId
const views = new Map<string, BrowserView>()
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

// Store resize handler reference to prevent listener accumulation
let resizeHandler: (() => void) | null = null

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
        logger.info('Tabs', `Auto-deleting cookies for inactive domain: ${domain}`)
        try {
          await session.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
          })
          domainActivity.delete(domain)
          domainSessions.delete(domain)
        } catch (error) {
          logger.error('Tabs', `Failed to clear storage for ${domain}:`, error)
        }
      }
    }
  }

  // Stop timer if no more domains to monitor (optimization: prevent idle CPU usage)
  if (domainActivity.size === 0 && cookieAutoDeleteTimer) {
    clearInterval(cookieAutoDeleteTimer)
    cookieAutoDeleteTimer = null
    logger.debug('Tabs', 'Cookie auto-delete timer stopped (no domains to monitor)')
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
      logger.error('Tabs', 'Cookie auto-delete check failed:', error)
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
  let chromeHeight = NAVBAR_HEIGHT + CHROME_BUFFER
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

  logger.debug('Tabs', `Created isolated session for domain: ${domain}`)
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

function updateViewBounds(view: BrowserView): void {
  if (!mainWindow) return
  const bounds = mainWindow.getContentBounds()

  // Get appearance settings
  const appearance: AppearanceSettings = getSetting('appearance')
  const isVertical = appearance.tabOrientation === 'vertical'
  const sidebarWidth = appearance.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH
  const showBookmarksBar = appearance.showBookmarksBar ?? false

  // Calculate chrome height dynamically based on visible components
  let chromeHeight = NAVBAR_HEIGHT + CHROME_BUFFER
  if (!isVertical) {
    chromeHeight += TABBAR_HEIGHT // Horizontal mode has tab bar row
  }
  if (showBookmarksBar) {
    chromeHeight += BOOKMARKS_HEIGHT // Add bookmarks bar if visible
  }

  // Calculate dimensions based on tab orientation
  const x = isVertical ? sidebarWidth : 0
  const width = isVertical ? bounds.width - sidebarWidth : bounds.width

  // Use full available space
  // Anti-fingerprinting is handled by JavaScript injection (spoofs window dimensions)
  view.setBounds({
    x,
    y: chromeHeight,
    width,
    height: bounds.height - chromeHeight - STATUSBAR_HEIGHT,
  })
}

function setupViewEvents(view: BrowserView, tabId: string): void {
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

    // Update history with new title
    const url = view.webContents.getURL()
    historyManager.addEntry(url, title)
  })

  // Extract and send favicon when page finishes loading
  view.webContents.on('did-finish-load', async () => {
    try {
      const favicon = await extractFavicon(view)
      if (favicon) {
        mainWindow?.webContents.send('page:favicon', favicon, tabId)
      }
    } catch (error) {
      logger.debug('Tabs', `Failed to extract favicon for tab ${tabId}:`, error)
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

    logger.warn('Tabs', `Page load failed: ${errorDescription} (code: ${errorCode}) for ${validatedURL}`)
    loadErrorPage(view, `${errorDescription} (${errorCode})`, validatedURL)
  })

  // Security: Intercept navigation to validate URLs (blocks javascript:, data:, file:, etc.)
  view.webContents.on('will-navigate', (event, url) => {
    try {
      const normalized = normalizeUrl(url)
      const parsed = new URL(normalized)

      // If URL was normalized, redirect to normalized version
      if (normalized !== url) {
        event.preventDefault()
        logger.debug('Tabs', `Normalizing URL: ${url} → ${normalized}`)
        view.webContents.loadURL(normalized).catch((err) => {
          logger.error('Tabs', 'loadURL failed (normalization):', err)
          loadErrorPage(view, err.message, normalized)
        })
        return
      }

      if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
        console.warn(`[Tabs] Blocked navigation to unsafe URL: ${url}`)
        event.preventDefault()
      }
    } catch {
      console.warn(`[Tabs] Blocked navigation to invalid URL: ${url}`)
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
          logger.debug('Tabs', `Normalizing popup URL: ${url} → ${targetUrl}`)
        }
        mainWindow?.webContents.send('context:open-link', targetUrl)
      } else {
        console.warn(`[Tabs] Blocked popup to unsafe URL: ${url}`)
      }
    } catch {
      console.warn(`[Tabs] Blocked popup to invalid URL: ${url}`)
    }
    return { action: 'deny' } // Never create popup windows
  })

  // Fallback: Close any window that somehow gets created (shouldn't happen with setWindowOpenHandler)
  view.webContents.on('did-create-window', (childWindow, { url }) => {
    console.warn(`[Tabs] Unexpected child window created, closing and redirecting: ${url}`)
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
    logger.error('Tabs', `Failed to create tab ${tabId}:`, error)
    // Cleanup: Remove any partially created state
    views.delete(tabId)
    tabDomains.delete(tabId)
    return false
  }
}

export function closeTab(tabId: string): boolean {
  const view = views.get(tabId)
  if (!view) return false

  // Remove all event listeners to prevent memory leaks
  view.webContents.removeAllListeners()

  // Remove from window
  if (mainWindow) {
    mainWindow.removeBrowserView(view)
  }

  // Destroy the view
  ;(view.webContents as any).destroy()
  views.delete(tabId)
  tabDomains.delete(tabId)

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

  // Use setBrowserView to avoid listener accumulation
  // setBrowserView replaces the current view automatically
  mainWindow.setBrowserView(view)
  updateViewBounds(view)
  activeViewId = tabId

  return true
}

export function getActiveView(): BrowserView | null {
  if (!activeViewId) return null
  return views.get(activeViewId) || null
}

export function getActiveTabId(): string | null {
  return activeViewId
}

export function hideAllViews(): void {
  if (!mainWindow) return

  // Set null to remove all views without adding listeners
  mainWindow.setBrowserView(null)
}

export function showActiveView(): void {
  if (!mainWindow) return
  const view = getActiveView()
  if (view) {
    // Use setBrowserView to avoid listener accumulation
    mainWindow.setBrowserView(view)
    updateViewBounds(view)
  }
}

// Allowed URL schemes for security
// Only http: is allowed - TON proxy doesn't support HTTPS tunneling
// Security is handled by the TON network itself
const ALLOWED_SCHEMES = ['http:']

/**
 * Loads error page in BrowserView when navigation fails.
 * Uses inline data URL to avoid file path issues and infinite loops.
 */
function loadErrorPage(view: BrowserView, errorMessage: string, failedUrl: string): void {
  // Use data URL with inline HTML to avoid file path issues
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      background: linear-gradient(135deg, #1a1f2e 0%, #252b3d 100%);
      color: #e4e7eb;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .error-container { max-width: 600px; text-align: center; }
    .error-icon {
      width: 120px; height: 120px; margin: 0 auto 32px;
      background: rgba(239, 68, 68, 0.1);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 60px;
    }
    h1 { font-size: 32px; font-weight: 600; margin-bottom: 16px; color: #f9fafb; }
    .error-message { font-size: 16px; line-height: 1.6; color: #9ca3af; margin-bottom: 24px; }
    .error-details {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px; padding: 16px; margin-bottom: 32px; text-align: left;
    }
    .error-code { font-family: monospace; font-size: 14px; color: #ef4444; word-break: break-all; }
    .url { font-family: monospace; font-size: 13px; color: #6b7280; margin-top: 8px; word-break: break-all; }
    .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    button {
      padding: 12px 24px; font-size: 15px; font-weight: 500;
      border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s;
    }
    .btn-primary { background: #0ea5e9; color: white; }
    .btn-primary:hover { background: #0284c7; }
    .btn-secondary { background: rgba(255, 255, 255, 0.1); color: #e4e7eb; border: 1px solid rgba(255, 255, 255, 0.2); }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.15); }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">⚠️</div>
    <h1>Unable to Load Page</h1>
    <p class="error-message">The page could not be loaded. Check your connection to the TON network.</p>
    <div class="error-details">
      <div class="error-code">Error: ${errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="url">URL: ${failedUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    </div>
    <div class="actions">
      <button class="btn-primary" onclick="location.href=decodeURIComponent('${encodeURIComponent(failedUrl)}')">\u{1F504} Retry</button>
      <button class="btn-secondary" onclick="history.back()">← Go Back</button>
    </div>
  </div>
</body>
</html>`

  view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`).catch((err) => {
    logger.error('Tabs', 'Failed to load error page:', err)
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
      console.error(`[Tabs] Blocked navigation to unsafe scheme: ${parsed.protocol}`)
      return false
    }
  } catch (err) {
    console.error(`[Tabs] Invalid URL: ${navigateUrl}`, err)
    return false
  }

  // Track domain for first-party isolation
  const domain = extractDomain(navigateUrl)
  const currentDomain = tabDomains.get(tabId)
  const isActive = activeViewId === tabId

  // If navigating to different domain, recreate view with new session
  if (currentDomain && currentDomain !== domain) {
    console.log(`[Tabs] Domain changed: ${currentDomain} -> ${domain}, recreating view`)

    // Remove old view
    view.webContents.removeAllListeners()
    if (mainWindow) {
      mainWindow.removeBrowserView(view)
    }
    ;(view.webContents as any).destroy()

    // Create new view with new domain's session (await proxy setup)
    const newSession = await getSessionForDomain(domain)
    const newView = createBrowserView(newSession)
    setupViewEvents(newView, tabId)
    views.set(tabId, newView)
    tabDomains.set(tabId, domain)
    updateDomainActivity(domain)

    // Show new view if this is the active tab
    if (isActive && mainWindow) {
      mainWindow.setBrowserView(newView)
      updateViewBounds(newView)
    }

    // Navigate in new view (proxy is ready)
    newView.webContents.loadURL(navigateUrl).catch((err) => {
      logger.error('Tabs', 'loadURL failed (new view):', err)
      loadErrorPage(newView, err.message, navigateUrl)
    })
  } else {
    // Same domain or first navigation
    tabDomains.set(tabId, domain)
    updateDomainActivity(domain)

    // Ensure view is visible (may have been hidden for ton:// pages)
    if (isActive && mainWindow) {
      mainWindow.setBrowserView(view)
      updateViewBounds(view)
    }

    view.webContents.loadURL(navigateUrl).catch((err) => {
      logger.error('Tabs', 'loadURL failed:', err)
      loadErrorPage(view, err.message, navigateUrl)
    })
  }

  return true
}

export function getTabCount(): number {
  return views.size
}

export function destroyAllTabs(): void {
  Array.from(views.keys()).forEach((tabId) => {
    closeTab(tabId)
  })
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
