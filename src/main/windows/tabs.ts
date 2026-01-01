/**
 * Tab manager for multi-tab browsing.
 * Creates, switches, and manages BrowserViews.
 */

import { BrowserView, BrowserWindow, Menu, clipboard } from 'electron'
import { createTonSession, createBrowserView } from './browser-view'
import { DEFAULT_PROXY_PORT } from '../../shared/constants'

const CHROME_HEIGHT = 136 // tabbar (44) + navbar (44) + bookmarks (40) + buffer (8)
const STATUSBAR_HEIGHT = 24

// Map of all BrowserViews by tabId
const views = new Map<string, BrowserView>()
let activeViewId: string | null = null
let mainWindow: BrowserWindow | null = null
let proxyPort = DEFAULT_PROXY_PORT
let tonSession: Electron.Session | null = null

// Store resize handler reference to prevent listener accumulation
let resizeHandler: (() => void) | null = null

export function initTabManager(win: BrowserWindow, port: number): void {
  // Remove old resize listener if it exists (prevents accumulation on reconnect)
  if (resizeHandler && mainWindow) {
    mainWindow.off('resize', resizeHandler)
  }

  mainWindow = win
  proxyPort = port
  tonSession = createTonSession(proxyPort)

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

  // Security: Intercept navigation to validate URLs (blocks javascript:, data:, file:, etc.)
  view.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url)
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
      const parsed = new URL(url)
      if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
        // Open valid http/https URLs in new tab (goes through proxy)
        mainWindow?.webContents.send('context:open-link', url)
      } else {
        console.warn(`[Tabs] Blocked popup to unsafe URL: ${url}`)
      }
    } catch {
      console.warn(`[Tabs] Blocked popup to invalid URL: ${url}`)
    }
    return { action: 'deny' }  // Never create popup windows
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

export function createTab(tabId: string): boolean {
  if (!mainWindow || !tonSession) return false
  if (views.has(tabId)) return false

  const view = createBrowserView(tonSession)
  setupViewEvents(view, tabId)
  views.set(tabId, view)

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
const ALLOWED_SCHEMES = ['http:', 'https:']

export function navigateInTab(tabId: string, url: string): boolean {
  const view = views.get(tabId)
  if (!view) return false

  let navigateUrl = url

  // Auto-add http:// if no scheme provided
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ton://')) {
    navigateUrl = `http://${url}`
  }

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

  view.webContents.loadURL(navigateUrl)
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
