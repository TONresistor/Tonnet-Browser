/**
 * IPC handlers for renderer-to-main communication.
 * Handles proxy, tabs, navigation, storage, and settings.
 */

import { ipcMain, BrowserWindow, session, dialog, Menu, shell, IpcMainInvokeEvent } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import { isValidNavigationUrl, isValidBagId, isValidDownloadPath, RateLimiter } from './validation'
import { handleWithErrors, ipcErrorHandler } from './error-handler'
import { logger } from '../../shared/logger'
import { SETTINGS_CATEGORIES } from '../settings/validation'

// Lenient limits: 30 nav/sec, 10 storage ops/sec
const navLimiter = new RateLimiter(30, 1000)
const storageLimiter = new RateLimiter(10, 1000)

/**
 * Validate bag ID and return an error response if invalid.
 * Returns null if valid, or an error response object to short-circuit from handlers.
 */
function validateBagIdOrFail(bagId: string): { success: false; error: string } | null {
  if (!isValidBagId(bagId)) {
    return { success: false, error: 'Invalid bag ID format (must be 64 hex characters)' }
  }
  return null
}
import { proxyManager } from '../proxy/manager'
import { storageManager } from '../storage/daemon'
import { addBag, removeBag, listBags, pauseBag, getBagDetails } from '../storage/bags'
import { contentFilterManager } from '../content-filter/filter-manager'
import {
  loadSettings,
  getSetting,
  setSetting,
  resetSettings,
  getDownloadPath,
  setDownloadPath,
  AppSettings,
} from '../settings'
import { getMainWindow } from '../windows/main'
import {
  initTabManager,
  createTab,
  closeTab,
  switchTab,
  getActiveView,
  hideAllViews,
  showActiveView,
  navigateInTab,
  getActiveTabId,
  onPrivacySettingsChanged,
  onAppearanceSettingsChanged,
  updateSidebarWidth,
} from '../windows/tabs'
import { historyManager, HistoryMode } from '../history/manager'

// Guard to prevent multiple listener registrations
let handlersRegistered = false

// Test-only: reset the guard to allow re-registration in tests
export function _resetHandlersForTesting(): void {
  handlersRegistered = false
}

/**
 * Security: Verify IPC call originates from the main window, not a compromised tab/BrowserView
 * This prevents a malicious website from invoking privileged IPC handlers
 */
function verifyIpcOrigin(event: IpcMainInvokeEvent): void {
  const mainWindow = getMainWindow()
  if (!mainWindow) {
    throw new Error('Main window not available')
  }

  // Check if sender is the main window's webContents (not a BrowserView)
  if (event.sender !== mainWindow.webContents) {
    logger.error('IPC', 'Unauthorized IPC call from non-main-window sender')
    throw new Error('Unauthorized: IPC calls must originate from main window')
  }
}

/**
 * Secure ipcMain.handle wrapper - verifies origin + catches errors
 * All IPC handlers should use this to prevent calls from compromised BrowserViews
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function secureHandle(channel: string, handler: (...args: any[]) => any): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    verifyIpcOrigin(event)
    return handler(...args)
  })
}

/**
 * Secure ipcMain.handle wrapper for handlers that need the event parameter
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function secureHandleWithEvent(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    verifyIpcOrigin(event)
    return handler(event, ...args)
  })
}

/**
 * Wrapper for handleWithErrors that adds origin verification
 * Use for handlers that need the full error wrapping + origin check
 */
function handleSecure<T = unknown>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T
): void {
  handleWithErrors(channel, async (event, ...args) => {
    verifyIpcOrigin(event)
    return await handler(event, ...args)
  })
}

export function registerIpcHandlers(): void {
  // Prevent duplicate listener registration (causes memory leaks)
  if (handlersRegistered) {
    logger.warn('IPC', 'Handlers already registered, skipping duplicate registration')
    return
  }
  handlersRegistered = true

  // ===== Proxy Status Events =====
  proxyManager.on('status', (status) => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('proxy:status', proxyManager.getStatus())
      // Update window title to show connection status
      const title = status === 'connected' ? 'TON Browser [Connected]' : 'TON Browser'
      win.setTitle(title)
    }
  })

  proxyManager.on('error', (message) => {
    logger.error('ProxyManager', `Error: ${message}`)
  })

  // ===== Storage Events =====
  storageManager.on('bags-updated', (bags) => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('storage:bags-updated', bags)
    }
  })

  storageManager.on('started', () => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('storage:status', { running: true })
    }
  })

  storageManager.on('stopped', () => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('storage:status', { running: false })
    }
  })

  storageManager.on('error', (message) => {
    logger.error('StorageManager', `Error: ${message}`)
  })

  // ===== Proxy Handlers =====
  handleSecure(IPC_CHANNELS.PROXY_CONNECT, async () => {
    const win = getMainWindow()

    // Helper to send progress updates
    const sendProgress = (step: number, message: string) => {
      if (win) {
        win.webContents.send('proxy:progress', { step, message })
      }
    }

    // Step 0: Starting proxy
    sendProgress(0, 'Starting proxy...')
    await proxyManager.start()

    // Step 1: Loading configuration
    sendProgress(1, 'Loading configuration...')
    await new Promise((r) => setTimeout(r, 300)) // Small delay for visual feedback

    // Step 2: Starting DHT
    sendProgress(2, 'Starting DHT...')
    await new Promise((r) => setTimeout(r, 400))

    // Step 3: Connecting to network
    sendProgress(3, 'Connecting to network...')
    await new Promise((r) => setTimeout(r, 400))

    // Initialize TabManager with proxy
    if (win) {
      initTabManager(win, proxyManager.getStatus().port)
    }

    // Also start storage daemon
    try {
      await storageManager.start()
      logger.info('IPC', 'Storage daemon started')
    } catch (storageError) {
      logger.error('IPC', `Failed to start storage: ${String(storageError)}`)
      // Non-critical: continue even if storage fails
    }

    // Step 4: Ready
    sendProgress(4, 'Ready!')

    return { success: true, ...proxyManager.getStatus() }
  })

  secureHandle(IPC_CHANNELS.PROXY_DISCONNECT, async () => {
    storageManager.stop()
    proxyManager.stop()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.PROXY_STATUS, () => {
    return proxyManager.getStatus()
  })

  // ===== Tab Handlers =====
  secureHandleWithEvent(IPC_CHANNELS.TAB_CREATE, async (_event, tabId: string) => {
    logger.debug('IPC', `Tab create: ${tabId}`)
    const success = await createTab(tabId)
    return { success }
  })

  secureHandleWithEvent(IPC_CHANNELS.TAB_CLOSE, (_event, tabId: string) => {
    logger.debug('IPC', `Tab close: ${tabId}`)
    const success = closeTab(tabId)
    return { success }
  })

  secureHandleWithEvent(IPC_CHANNELS.TAB_SWITCH, (_event, tabId: string) => {
    logger.debug('IPC', `Tab switch: ${tabId}`)
    const success = switchTab(tabId)
    return { success }
  })

  // ===== View Handlers =====
  secureHandle(IPC_CHANNELS.VIEW_HIDE, () => {
    hideAllViews()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.VIEW_SHOW, () => {
    showActiveView()
    return { success: true }
  })

  // ===== Navigation Handlers =====
  secureHandleWithEvent(IPC_CHANNELS.NAVIGATE, async (_event, url: string, tabId?: string) => {
    // Rate limit navigation requests
    if (!navLimiter.check()) {
      return { success: false, error: 'Rate limited' }
    }

    logger.debug('IPC', `Navigate called with URL: ${url}, tabId: ${tabId || 'none'}`)

    // Security: Validate URL before navigation
    const validation = isValidNavigationUrl(url)
    if (!validation.valid) {
      logger.warn('IPC', `Blocked invalid URL: ${url} (${validation.error})`)
      return { success: false, error: validation.error }
    }

    // Don't load internal ton:// URLs in BrowserView
    if (url.startsWith('ton://')) {
      logger.debug('IPC', 'Internal URL, hiding views')
      hideAllViews()
      return { success: true, internal: true }
    }

    // navigateInTab handles view visibility (show/attach) internally
    const targetTabId = tabId || getActiveTabId()
    if (targetTabId) {
      const success = await navigateInTab(targetTabId, url)
      return { success }
    }

    logger.warn('IPC', 'No active tab')
    return { success: false, error: 'No active tab' }
  })

  secureHandle(IPC_CHANNELS.GO_BACK, () => {
    const view = getActiveView()
    if (view?.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.GO_FORWARD, () => {
    const view = getActiveView()
    if (view?.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.RELOAD, () => {
    const view = getActiveView()
    if (view) {
      view.webContents.reload()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.STOP, () => {
    const view = getActiveView()
    if (view) {
      view.webContents.stop()
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.ZOOM_IN, () => {
    const view = getActiveView()
    if (view) {
      const { zoomMax } = getSetting('appearance')
      const maxFactor = zoomMax / 100
      const currentZoom = view.webContents.getZoomFactor()
      view.webContents.setZoomFactor(Math.min(currentZoom + 0.1, maxFactor))
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.ZOOM_OUT, () => {
    const view = getActiveView()
    if (view) {
      const { zoomMin } = getSetting('appearance')
      const minFactor = zoomMin / 100
      const currentZoom = view.webContents.getZoomFactor()
      view.webContents.setZoomFactor(Math.max(currentZoom - 0.1, minFactor))
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.ZOOM_RESET, () => {
    const view = getActiveView()
    if (view) {
      const { defaultZoom } = getSetting('appearance')
      view.webContents.setZoomFactor(defaultZoom / 100)
      return { success: true }
    }
    return { success: false }
  })

  secureHandle(IPC_CHANNELS.TOGGLE_DEVTOOLS, () => {
    const view = getActiveView()
    if (view) {
      if (view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools()
      } else {
        view.webContents.openDevTools({ mode: 'detach' })
      }
      return { success: true }
    }
    return { success: false }
  })

  // ===== Storage Handlers =====
  handleSecure(IPC_CHANNELS.STORAGE_ADD_BAG, async (_event, bagId: string, name?: string) => {
    // Rate limit storage operations
    if (!storageLimiter.check()) {
      return { success: false, error: 'Rate limited' }
    }

    // Security: Validate bag ID format
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError

    const bag = await addBag(bagId, name)
    return { success: true, bag }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_REMOVE_BAG, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    const result = await removeBag(bagId)
    return { success: result }
  })

  secureHandle(IPC_CHANNELS.STORAGE_LIST_BAGS, async () => {
    const bags = await listBags()
    return { success: true, bags }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_PAUSE_BAG, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    const result = await pauseBag(bagId)
    return { success: result }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_GET_DETAILS, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    try {
      const details = await getBagDetails(bagId)
      return { success: true, details }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_OPEN_FOLDER, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    try {
      const details = await getBagDetails(bagId)
      if (!details?.path) {
        return { success: false, error: 'Bag path not found' }
      }
      const error = await shell.openPath(details.path)
      return error ? { success: false, error } : { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_SHOW_FILE, async (_event, bagId: string, fileName: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError

    // Validate fileName to prevent path traversal
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return { success: false, error: 'Invalid file name: path separators not allowed' }
    }

    // Validate length and null bytes
    if (fileName.length > 255 || fileName.includes('\0')) {
      return { success: false, error: 'Invalid file name: exceeds length limit or contains null bytes' }
    }

    // Sanitize fileName using path.basename to ensure it's just a filename
    const sanitizedFileName = path.basename(fileName)
    if (sanitizedFileName !== fileName) {
      return { success: false, error: 'Invalid file name format' }
    }

    try {
      const details = await getBagDetails(bagId)
      if (!details?.path) {
        return { success: false, error: 'Bag path not found' }
      }
      shell.showItemInFolder(path.join(details.path, sanitizedFileName))
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ===== Bookmark Context Menu =====
  secureHandleWithEvent(IPC_CHANNELS.BOOKMARK_SHOW_MENU, (_event, id: string, title: string, url: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open in new tab',
        click: () => {
          if (isValidNavigationUrl(url).valid) {
            win.webContents.send('bookmark:open-new-tab', url)
          }
        },
      },
      {
        label: 'Edit',
        click: () => win.webContents.send('bookmark:edit', { id, title, url }),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => win.webContents.send('bookmark:delete', id),
      },
    ])

    menu.popup({ window: win })
  })

  // ===== Folder Dropdown Menu =====
  secureHandleWithEvent(
    IPC_CHANNELS.FOLDER_SHOW_MENU,
    (_event, folderId: string, bookmarks: Array<{ id: string; title: string; url: string }>) => {
      const win = getMainWindow()
      if (!win) return

      // Build menu items from bookmarks
      const menuItems: Electron.MenuItemConstructorOptions[] = bookmarks.map((bookmark) => ({
        label: bookmark.title,
        click: () => {
          if (!isValidNavigationUrl(bookmark.url).valid) return
          const activeTabId = getActiveTabId()
          if (activeTabId) {
            navigateInTab(activeTabId, bookmark.url)
          }
        },
      }))

      // Show "Empty folder" if no bookmarks
      if (menuItems.length === 0) {
        menuItems.push({
          label: 'Empty folder',
          enabled: false,
        })
      }

      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup({ window: win })
    }
  )

  // ===== Folder Context Menu =====
  secureHandleWithEvent(IPC_CHANNELS.FOLDER_SHOW_CONTEXT_MENU, (_event, folderId: string, folderName: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Rename',
        click: () => win.webContents.send('folder:rename', { folderId, folderName }),
      },
      {
        label: 'Open all bookmarks',
        click: () => win.webContents.send('folder:open-all', folderId),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => win.webContents.send('folder:delete', folderId),
      },
    ])

    menu.popup({ window: win })
  })

  // ===== Window Handlers =====
  secureHandle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = getMainWindow()
    win?.minimize()
  })

  secureHandle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  secureHandle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = getMainWindow()
    win?.close()
  })

  // Immediate sidebar width update (for real-time resize)
  secureHandleWithEvent(IPC_CHANNELS.UPDATE_SIDEBAR_WIDTH, (_event, width: number) => {
    // Validate width parameter
    if (typeof width !== 'number' || width < 0 || width > 3000 || !isFinite(width)) {
      return { success: false, error: 'Invalid width parameter' }
    }
    updateSidebarWidth(width)
    return { success: true }
  })

  // ===== Settings Handlers =====
  handleSecure(IPC_CHANNELS.CLEAR_BROWSING_DATA, async () => {
    const ses = session.fromPartition('persist:ton-browser')
    await ses.clearCache()
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
    })
    logger.info('Settings', 'Browsing data cleared')
    return { success: true }
  })

  // ===== Storage Settings Handlers =====
  secureHandle(IPC_CHANNELS.STORAGE_GET_DOWNLOAD_PATH, () => {
    return { success: true, path: getDownloadPath() }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_SET_DOWNLOAD_PATH, (_event, inputPath: string) => {
    // Security: Validate path before setting
    const validation = isValidDownloadPath(inputPath)
    if (!validation.valid) {
      logger.warn('Settings', `Invalid download path: ${inputPath} - ${validation.error}`)
      return { success: false, error: validation.error }
    }

    try {
      setDownloadPath(inputPath)
      // Update the storage manager with new path
      storageManager.setStoragePath(inputPath)
      logger.info('Settings', `Download path set to: ${inputPath}`)
      return { success: true }
    } catch (error) {
      logger.error('Settings', `Failed to set download path: ${String(error)}`)
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandle(IPC_CHANNELS.STORAGE_SELECT_DOWNLOAD_FOLDER, async () => {
    const win = getMainWindow()
    if (!win) {
      return { success: false, error: 'No window available' }
    }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select TON Storage Download Folder',
      buttonLabel: 'Select Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const selectedPath = result.filePaths[0]
    setDownloadPath(selectedPath)
    storageManager.setStoragePath(selectedPath)
    logger.info('Settings', `Download folder selected: ${selectedPath}`)
    return { success: true, path: selectedPath }
  })

  // ===== App Settings Handlers =====
  secureHandle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return loadSettings()
  })

  secureHandleWithEvent(IPC_CHANNELS.SETTINGS_GET, (_event, category: keyof AppSettings) => {
    // Validate category parameter
    if (typeof category !== 'string' || !(SETTINGS_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error('Invalid settings category')
    }
    return getSetting(category)
  })

  secureHandleWithEvent(IPC_CHANNELS.SETTINGS_SET, async (_event, category: keyof AppSettings, values: object) => {
    // Validate category parameter
    if (typeof category !== 'string' || !(SETTINGS_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error('Invalid settings category')
    }
    // Validate values parameter
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new Error('Settings values must be a non-null object')
    }
    setSetting(category, values as any)
    // Notify renderer of settings change
    const win = getMainWindow()
    if (win) {
      win.webContents.send('settings:changed', { category, values })
    }
    // If network settings changed, check if proxy needs restart
    if (category === 'network' && proxyManager.isRunning()) {
      await proxyManager.applySettingsChange()
    }
    // If privacy settings changed, restart cookie auto-delete timer
    if (category === 'privacy') {
      onPrivacySettingsChanged()
    }
    // If appearance settings changed, update BrowserView bounds (for tab orientation)
    if (category === 'appearance') {
      onAppearanceSettingsChanged()
    }
    // If content filtering settings changed, apply immediately to filter manager
    if (category === 'contentFiltering') {
      contentFilterManager.applySettings(getSetting('contentFiltering'))
    }
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.SETTINGS_RESET, () => {
    resetSettings()
    const win = getMainWindow()
    if (win) {
      win.webContents.send('settings:changed', { reset: true })
    }
    // Restart cookie auto-delete timer with default settings
    onPrivacySettingsChanged()
    return { success: true }
  })

  // ===== History Handlers =====
  secureHandleWithEvent(IPC_CHANNELS.HISTORY_CHANGE_MODE, async (_event, mode: HistoryMode) => {
    try {
      const result = await historyManager.changeMode(mode)
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_SEARCH, (_event, query: string, limit?: number) => {
    try {
      return historyManager.search(query, limit)
    } catch (error) {
      logger.error('History', `Search failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_RECENT, (_event, limit?: number) => {
    try {
      return historyManager.getRecent(limit)
    } catch (error) {
      logger.error('History', `Get recent failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_TOP, (_event, limit?: number) => {
    try {
      return historyManager.getTopVisited(limit)
    } catch (error) {
      logger.error('History', `Get top visited failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_BY_DATE, (_event, startDate: number, endDate: number) => {
    try {
      return historyManager.getByDateRange(startDate, endDate)
    } catch (error) {
      logger.error('History', `Get by date range failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_DELETE, (_event, id: string) => {
    try {
      const success = historyManager.deleteEntry(id)
      return { success }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_DELETE_PATTERN, (_event, pattern: string) => {
    try {
      const count = historyManager.deleteByPattern(pattern)
      return { success: true, count }
    } catch (error) {
      return { success: false, error: (error as Error).message, count: 0 }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_CLEAR, () => {
    try {
      historyManager.clear()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_STATS, () => {
    try {
      return historyManager.getStats()
    } catch (error) {
      return {
        total: 0,
        mode: 'memory' as HistoryMode,
        isLocked: false,
      }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_HAS_PERSISTENT_FILE, () => {
    try {
      return historyManager.hasPersistentFile()
    } catch (error) {
      return false
    }
  })

  // ===== Error Logging Handlers (for debugging) =====
  secureHandleWithEvent(IPC_CHANNELS.ERRORS_GET_RECENT, (_event, limit?: number) => {
    return ipcErrorHandler.getRecentErrors(limit)
  })

  secureHandleWithEvent(IPC_CHANNELS.ERRORS_CLEAR, () => {
    ipcErrorHandler.clearLogs()
    return { success: true }
  })
}
