/**
 * IPC handlers for renderer-to-main communication.
 * Handles proxy, tabs, navigation, storage, and settings.
 */

import { ipcMain, BrowserWindow, session, dialog, Menu, shell } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import { isValidNavigationUrl, isValidBagId, isValidDownloadPath, RateLimiter } from './validation'
import { handleWithErrors, ipcErrorHandler } from './error-handler'
import { logger } from '../../shared/logger'

// Lenient limits: 30 nav/sec, 10 storage ops/sec
const navLimiter = new RateLimiter(30, 1000)
const storageLimiter = new RateLimiter(10, 1000)
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
  AppSettings
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
  onPrivacySettingsChanged
} from '../windows/tabs'
import { historyManager, HistoryMode } from '../history/manager'

// Guard to prevent multiple listener registrations
let handlersRegistered = false

// Test-only: reset the guard to allow re-registration in tests
export function _resetHandlersForTesting(): void {
  handlersRegistered = false
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
      win.webContents.send('proxy:status', { status, ...proxyManager.getStatus() })
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
  handleWithErrors(IPC_CHANNELS.PROXY_CONNECT, async () => {
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
    await new Promise(r => setTimeout(r, 300)) // Small delay for visual feedback

    // Step 2: Starting DHT
    sendProgress(2, 'Starting DHT...')
    await new Promise(r => setTimeout(r, 400))

    // Step 3: Connecting to network
    sendProgress(3, 'Connecting to network...')
    await new Promise(r => setTimeout(r, 400))

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

  ipcMain.handle(IPC_CHANNELS.PROXY_DISCONNECT, async () => {
    storageManager.stop()
    proxyManager.stop()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.PROXY_STATUS, () => {
    return proxyManager.getStatus()
  })

  // ===== Tab Handlers =====
  ipcMain.handle(IPC_CHANNELS.TAB_CREATE, (_event, tabId: string) => {
    logger.debug('IPC', `Tab create: ${tabId}`)
    const success = createTab(tabId)
    return { success }
  })

  ipcMain.handle(IPC_CHANNELS.TAB_CLOSE, (_event, tabId: string) => {
    logger.debug('IPC', `Tab close: ${tabId}`)
    const success = closeTab(tabId)
    return { success }
  })

  ipcMain.handle(IPC_CHANNELS.TAB_SWITCH, (_event, tabId: string) => {
    logger.debug('IPC', `Tab switch: ${tabId}`)
    const success = switchTab(tabId)
    return { success }
  })

  // ===== View Handlers =====
  ipcMain.handle(IPC_CHANNELS.VIEW_HIDE, () => {
    hideAllViews()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.VIEW_SHOW, () => {
    showActiveView()
    return { success: true }
  })

  // ===== Navigation Handlers =====
  ipcMain.handle(IPC_CHANNELS.NAVIGATE, (_event, url: string, tabId?: string) => {
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

    // Show active view for external URLs
    showActiveView()

    const targetTabId = tabId || getActiveTabId()
    if (targetTabId) {
      const success = navigateInTab(targetTabId, url)
      return { success }
    }

    logger.warn('IPC', 'No active tab')
    return { success: false, error: 'No active tab' }
  })

  ipcMain.handle(IPC_CHANNELS.GO_BACK, () => {
    const view = getActiveView()
    if (view?.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack()
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.GO_FORWARD, () => {
    const view = getActiveView()
    if (view?.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward()
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.RELOAD, () => {
    const view = getActiveView()
    if (view) {
      view.webContents.reload()
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.STOP, () => {
    const view = getActiveView()
    if (view) {
      view.webContents.stop()
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.ZOOM_IN, () => {
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

  ipcMain.handle(IPC_CHANNELS.ZOOM_OUT, () => {
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

  ipcMain.handle(IPC_CHANNELS.ZOOM_RESET, () => {
    const view = getActiveView()
    if (view) {
      const { defaultZoom } = getSetting('appearance')
      view.webContents.setZoomFactor(defaultZoom / 100)
      return { success: true }
    }
    return { success: false }
  })

  ipcMain.handle(IPC_CHANNELS.TOGGLE_DEVTOOLS, () => {
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
  handleWithErrors(IPC_CHANNELS.STORAGE_ADD_BAG, async (_event, bagId: string, name?: string) => {
    // Rate limit storage operations
    if (!storageLimiter.check()) {
      return { success: false, error: 'Rate limited' }
    }

    // Security: Validate bag ID format
    if (!isValidBagId(bagId)) {
      logger.warn('IPC', `Invalid bag ID format: ${bagId}`)
      return { success: false, error: 'Invalid bag ID format (must be 64 hex characters)' }
    }

    const bag = await addBag(bagId, name)
    return { success: true, bag }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_REMOVE_BAG, async (_event, bagId: string) => {
    if (!isValidBagId(bagId)) {
      return { success: false, error: 'Invalid bag ID format' }
    }
    const result = await removeBag(bagId)
    return { success: result }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_LIST_BAGS, async () => {
    const bags = await listBags()
    return { success: true, bags }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_PAUSE_BAG, async (_event, bagId: string) => {
    if (!isValidBagId(bagId)) {
      return { success: false, error: 'Invalid bag ID format' }
    }
    const result = await pauseBag(bagId)
    return { success: result }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_DETAILS, async (_event, bagId: string) => {
    if (!isValidBagId(bagId)) {
      return { success: false, error: 'Invalid bag ID format' }
    }
    try {
      const details = await getBagDetails(bagId)
      return { success: true, details }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_OPEN_FOLDER, async (_event, bagId: string) => {
    if (!isValidBagId(bagId)) {
      return { success: false, error: 'Invalid bag ID' }
    }
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

  ipcMain.handle(IPC_CHANNELS.STORAGE_SHOW_FILE, async (_event, bagId: string, fileName: string) => {
    if (!isValidBagId(bagId)) {
      return { success: false, error: 'Invalid bag ID' }
    }

    // Validate fileName to prevent path traversal
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return { success: false, error: 'Invalid file name: path separators not allowed' }
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
  ipcMain.handle('bookmark:show-menu', (_event, id: string, title: string, url: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open in new tab',
        click: () => win.webContents.send('bookmark:open-new-tab', url)
      },
      {
        label: 'Edit',
        click: () => win.webContents.send('bookmark:edit', { id, title, url })
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => win.webContents.send('bookmark:delete', id)
      }
    ])

    menu.popup({ window: win })
  })

  // ===== Folder Dropdown Menu =====
  ipcMain.handle(
    'folder:show-menu',
    (_event, folderId: string, bookmarks: Array<{ id: string; title: string; url: string }>) => {
      const win = getMainWindow()
      if (!win) return

      // Build menu items from bookmarks
      const menuItems = bookmarks.map((bookmark) => ({
        label: bookmark.title,
        click: () => {
          // Navigate directly in the active tab (main process handles it)
          const activeTabId = getActiveTabId()
          if (activeTabId) {
            navigateInTab(activeTabId, bookmark.url)
          }
        }
      }))

      // Show "Empty folder" if no bookmarks
      if (menuItems.length === 0) {
        menuItems.push({
          label: 'Empty folder',
          enabled: false
        })
      }

      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup({ window: win })
    }
  )

  // ===== Folder Context Menu =====
  ipcMain.handle('folder:show-context-menu', (_event, folderId: string, folderName: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Rename',
        click: () => win.webContents.send('folder:rename', { folderId, folderName })
      },
      {
        label: 'Open all bookmarks',
        click: () => win.webContents.send('folder:open-all', folderId)
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => win.webContents.send('folder:delete', folderId)
      }
    ])

    menu.popup({ window: win })
  })

  // ===== Window Handlers =====
  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = getMainWindow()
    win?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = getMainWindow()
    win?.close()
  })

  // ===== Settings Handlers =====
  handleWithErrors(IPC_CHANNELS.CLEAR_BROWSING_DATA, async () => {
    const ses = session.fromPartition('persist:ton-browser')
    await ses.clearCache()
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
    })
    logger.info('Settings', 'Browsing data cleared')
    return { success: true }
  })

  // ===== Storage Settings Handlers =====
  ipcMain.handle(IPC_CHANNELS.STORAGE_GET_DOWNLOAD_PATH, () => {
    return { success: true, path: getDownloadPath() }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_SET_DOWNLOAD_PATH, (_event, inputPath: string) => {
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

  ipcMain.handle(IPC_CHANNELS.STORAGE_SELECT_DOWNLOAD_FOLDER, async () => {
    const win = getMainWindow()
    if (!win) {
      return { success: false, error: 'No window available' }
    }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select TON Storage Download Folder',
      buttonLabel: 'Select Folder'
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
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return loadSettings()
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, category: keyof AppSettings) => {
    return getSetting(category)
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, category: keyof AppSettings, values: object) => {
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
    // If content filtering settings changed, apply immediately to filter manager
    if (category === 'contentFiltering') {
      const filterSettings = getSetting('contentFiltering')
      contentFilterManager.setEnabled(filterSettings.enabled)
      contentFilterManager.setWhitelist(filterSettings.whitelistedDomains)
      contentFilterManager.setCategoryEnabled('ads', filterSettings.blockAds)
      contentFilterManager.setCategoryEnabled('trackers', filterSettings.blockTrackers)
      contentFilterManager.setCategoryEnabled('miners', filterSettings.blockMiners)
      contentFilterManager.setCategoryEnabled('malware', filterSettings.blockMalware)
      contentFilterManager.setCategoryEnabled('annoyances', filterSettings.blockAnnoyances)
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_RESET, () => {
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
  ipcMain.handle('history:change-mode', async (_event, mode: HistoryMode) => {
    try {
      const result = await historyManager.changeMode(mode)
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('history:search', (_event, query: string, limit?: number) => {
    try {
      return historyManager.search(query, limit)
    } catch (error) {
      logger.error('History', `Search failed: ${String(error)}`)
      return []
    }
  })

  ipcMain.handle('history:get-recent', (_event, limit?: number) => {
    try {
      return historyManager.getRecent(limit)
    } catch (error) {
      logger.error('History', `Get recent failed: ${String(error)}`)
      return []
    }
  })

  ipcMain.handle('history:get-top', (_event, limit?: number) => {
    try {
      return historyManager.getTopVisited(limit)
    } catch (error) {
      logger.error('History', `Get top visited failed: ${String(error)}`)
      return []
    }
  })

  ipcMain.handle('history:get-by-date', (_event, startDate: number, endDate: number) => {
    try {
      return historyManager.getByDateRange(startDate, endDate)
    } catch (error) {
      logger.error('History', `Get by date range failed: ${String(error)}`)
      return []
    }
  })

  ipcMain.handle('history:delete', (_event, id: string) => {
    try {
      const success = historyManager.deleteEntry(id)
      return { success }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('history:delete-pattern', (_event, pattern: string) => {
    try {
      const count = historyManager.deleteByPattern(pattern)
      return { success: true, count }
    } catch (error) {
      return { success: false, error: (error as Error).message, count: 0 }
    }
  })

  ipcMain.handle('history:clear', () => {
    try {
      historyManager.clear()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('history:get-stats', () => {
    try {
      return historyManager.getStats()
    } catch (error) {
      return {
        total: 0,
        mode: 'memory' as HistoryMode,
        isLocked: false
      }
    }
  })

  ipcMain.handle('history:has-persistent-file', () => {
    try {
      return historyManager.hasPersistentFile()
    } catch (error) {
      return false
    }
  })

  // ===== Error Logging Handlers (for debugging) =====
  ipcMain.handle('errors:get-recent', (_event, limit?: number) => {
    return ipcErrorHandler.getRecentErrors(limit)
  })

  ipcMain.handle('errors:clear', () => {
    ipcErrorHandler.clearLogs()
    return { success: true }
  })
}
