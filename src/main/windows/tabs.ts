/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages BrowserViews.
 */

import { BrowserView, BrowserWindow, Menu, clipboard } from 'electron'
import { createTonSession, createBrowserView } from './browser-view'
import { DEFAULT_PROXY_PORT } from '../../shared/constants'
import { getSetting } from '../settings'

const CHROME_HEIGHT = 136 // tabbar (44) + navbar (44) + bookmarks (40) + buffer (8)
const STATUSBAR_HEIGHT = 24

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
}

// Cookie auto-delete: Check for inactive domains and clear their cookies
async function checkInactiveDomains(): Promise<void> {
  const privacy = getSetting('privacy')
  const cookieAutoDelete = (privacy as any).cookieAutoDelete ?? false
  const cookieAutoDeleteMinutes = (privacy as any).cookieAutoDeleteMinutes ?? 30

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
        console.log(`[Tabs] Auto-deleting cookies for inactive domain: ${domain}`)
        try {
          await session.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers'],
          })
          domainActivity.delete(domain)
          domainSessions.delete(domain)
        } catch (error) {
          console.error(`[Tabs] Failed to clear storage for ${domain}:`, error)
        }
      }
    }
  }
}

// Start cookie auto-delete timer
function startCookieAutoDeleteTimer(): void {
  if (cookieAutoDeleteTimer) {
    clearInterval(cookieAutoDeleteTimer)
  }

  const privacy = getSetting('privacy')
  const cookieAutoDelete = (privacy as any).cookieAutoDelete ?? false

  if (!cookieAutoDelete) return

  // Check every minute
  cookieAutoDeleteTimer = setInterval(() => {
    checkInactiveDomains().catch((error) => {
      console.error('[Tabs] Cookie auto-delete check failed:', error)
    })
  }, 60000)
}

// Restart timer when settings change (called from IPC handlers)
export function onPrivacySettingsChanged(): void {
  startCookieAutoDeleteTimer()
}

// Get or create session for a domain (First-Party Isolation)
function getSessionForDomain(domain: string): Electron.Session {
  const privacy = getSetting('privacy')
  const firstPartyIsolation = (privacy as any).firstPartyIsolation ?? true // Default: enabled

  if (!firstPartyIsolation) {
    // First-party isolation disabled - use shared session
    if (!tonSession) {
      tonSession = createTonSession(proxyPort, 'persist:ton-browser')
    }
    return tonSession
  }

  // First-party isolation enabled - per-domain sessions
  if (domainSessions.has(domain)) {
    // Update activity for existing session
    updateDomainActivity(domain)
    return domainSessions.get(domain)!
  }

  // Create new session for this domain
  const partitionName = `persist:ton-domain-${domain}`
  const session = createTonSession(proxyPort, partitionName)
  domainSessions.set(domain, session)
  updateDomainActivity(domain)

  console.log(`[Tabs] Created isolated session for domain: ${domain}`)
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

  // Use full available space
  // Anti-fingerprinting is handled by JavaScript injection (spoofs window dimensions)
  view.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width: bounds.width,
    height: bounds.height - CHROME_HEIGHT - STATUSBAR_HEIGHT,
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
  })

  view.webContents.on('did-navigate-in-page', (_e, url) => {
    mainWindow?.webContents.send('page:navigate', {
      tabId,
      url,
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
    })
  })

  view.webContents.on('page-title-updated', (_e, title) => {
    mainWindow?.webContents.send('page:title', title, tabId)
  })

  // Security: Intercept navigation to validate URLs (blocks javascript:, data:, file:, https:, etc.)
  view.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url)
      // Convert tonsite:// to http:// (TON sites use this custom protocol)
      if (parsed.protocol === 'tonsite:') {
        event.preventDefault()
        const httpUrl = url.replace('tonsite://', 'http://')
        console.log(`[Tabs] Converting tonsite:// to http://: ${httpUrl}`)
        view.webContents.loadURL(httpUrl)
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
      let targetUrl = url
      const parsed = new URL(url)
      // Convert tonsite:// to http://
      if (parsed.protocol === 'tonsite:') {
        targetUrl = url.replace('tonsite://', 'http://')
        console.log(`[Tabs] Converting tonsite:// popup to http://: ${targetUrl}`)
        mainWindow?.webContents.send('context:open-link', targetUrl)
      } else if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
        // Open valid http:// URLs in new tab
        mainWindow?.webContents.send('context:open-link', targetUrl)
      } else {
        console.warn(`[Tabs] Blocked popup to unsafe URL: ${url}`)
      }
    } catch {
      console.warn(`[Tabs] Blocked popup to invalid URL: ${url}`)
    }
    return { action: 'deny' }  // Never create popup windows
  })

  // Fallback: Close any window that somehow gets created (shouldn't happen with setWindowOpenHandler)
  view.webContents.on('did-create-window', (childWindow, { url }) => {
    console.warn(`[Tabs] Unexpected child window created, closing and redirecting: ${url}`)
    childWindow.close()
    // Open in new tab instead
    if (url && url !== 'about:blank') {
      try {
        const parsed = new URL(url)
        let targetUrl = url
        if (parsed.protocol === 'tonsite:') {
          targetUrl = url.replace('tonsite://', 'http://')
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'tonsite:') {
          mainWindow?.webContents.send('context:open-link', targetUrl)
        }
      } catch {
        // Invalid URL, ignore
      }
    }
  })

  // Context menu for web pages
  view.webContents.on('context-menu', (_e, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    // Text editing options (when editable or text selected)
    if (params.isEditable) {
      menuItems.push(
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: params.editFlags.canCut, click: () => view.webContents.cut() },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: params.editFlags.canCopy, click: () => view.webContents.copy() },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: params.editFlags.canPaste, click: () => view.webContents.paste() },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => view.webContents.selectAll() }
      )
    } else if (params.selectionText) {
      menuItems.push(
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => view.webContents.copy() }
      )
    }

    // Link options
    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
        { label: 'Open Link in New Tab', click: () => mainWindow?.webContents.send('context:open-link', params.linkURL) },
        { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) }
      )
    }

    // Image options
    if (params.hasImageContents && params.srcURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
        { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) }
      )
    }

    // Navigation options (always show)
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    menuItems.push(
      { label: 'Back', accelerator: 'Alt+Left', enabled: view.webContents.navigationHistory.canGoBack(), click: () => view.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: 'Alt+Right', enabled: view.webContents.navigationHistory.canGoForward(), click: () => view.webContents.navigationHistory.goForward() },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => view.webContents.reload() }
    )

    const menu = Menu.buildFromTemplate(menuItems)
    menu.popup()
  })
}

export function createTab(tabId: string, initialUrl?: string): boolean {
  if (!mainWindow) return false
  if (views.has(tabId)) return false

  // Determine initial domain for session isolation
  const domain = initialUrl ? extractDomain(initialUrl) : 'default'
  const session = getSessionForDomain(domain)

  const view = createBrowserView(session)
  setupViewEvents(view, tabId)
  views.set(tabId, view)
  tabDomains.set(tabId, domain)

  // Switch to the new tab
  switchTab(tabId)

  return true
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

  // Hide current view
  if (activeViewId && activeViewId !== tabId) {
    const currentView = views.get(activeViewId)
    if (currentView) {
      mainWindow.removeBrowserView(currentView)
    }
  }

  // Show new view
  mainWindow.addBrowserView(view)
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

  // Remove all views from window so they don't capture mouse events
  views.forEach((view) => {
    mainWindow!.removeBrowserView(view)
  })
}

export function showActiveView(): void {
  if (!mainWindow) return
  const view = getActiveView()
  if (view) {
    // Re-add view to window and update bounds
    mainWindow.addBrowserView(view)
    updateViewBounds(view)
  }
}

// Allowed URL schemes for security
// Only http: is allowed - TON proxy doesn't support HTTPS tunneling
// Security is handled by the TON network itself
const ALLOWED_SCHEMES = ['http:']

export function navigateInTab(tabId: string, url: string): boolean {
  const view = views.get(tabId)
  if (!view) return false

  let navigateUrl = url

  // Convert tonsite:// to http://
  if (url.startsWith('tonsite://')) {
    navigateUrl = url.replace('tonsite://', 'http://')
    console.log(`[Tabs] Converting tonsite:// to http://: ${navigateUrl}`)
  }
  // Auto-add http:// if no scheme provided
  else if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ton://')) {
    navigateUrl = `http://${url}`
  }

  // Validate URL scheme for security (block data:, file:, javascript:, https:, etc.)
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

  // If navigating to different domain, recreate view with new session
  if (currentDomain && currentDomain !== domain) {
    console.log(`[Tabs] Domain changed: ${currentDomain} -> ${domain}, recreating view`)

    // Store current position in view stack
    const isActive = activeViewId === tabId

    // Remove old view
    view.webContents.removeAllListeners()
    if (mainWindow) {
      mainWindow.removeBrowserView(view)
    }
    ;(view.webContents as any).destroy()

    // Create new view with new domain's session
    const newSession = getSessionForDomain(domain)
    const newView = createBrowserView(newSession)
    setupViewEvents(newView, tabId)
    views.set(tabId, newView)
    tabDomains.set(tabId, domain)

    // Restore active state
    if (isActive && mainWindow) {
      mainWindow.addBrowserView(newView)
      updateViewBounds(newView)
    }

    // Navigate in new view
    newView.webContents.loadURL(navigateUrl)
  } else {
    // Same domain or first navigation, just load URL
    tabDomains.set(tabId, domain)
    updateDomainActivity(domain)
    view.webContents.loadURL(navigateUrl)
  }

  return true
}

export function getTabCount(): number {
  return views.size
}

export function destroyAllTabs(): void {
  views.forEach((view, tabId) => {
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
