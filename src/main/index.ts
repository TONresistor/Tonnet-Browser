/**
 * Main process entry point.
 * Creates the browser window and initializes all services.
 */

import { app, BrowserWindow, shell, screen, session, Menu, clipboard } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { EventEmitter } from 'events'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { proxyManager } from './proxy/manager'
import { storageManager } from './storage/daemon'
import { setMainWindow } from './windows/main'
import { getSetting } from './settings'
import { initTabManager } from './windows/tabs'

// Memory leak prevention: increase limit slightly and log warnings
EventEmitter.defaultMaxListeners = 15

// Global error handlers - must be registered early to catch all errors
process.on('uncaughtException', (error: Error) => {
  console.error('[CRITICAL] Uncaught Exception:', error.message)
  console.error('[CRITICAL] Stack:', error.stack)

  // Attempt graceful shutdown of services
  try {
    proxyManager.stop()
    storageManager.stop()
  } catch {
    // Ignore cleanup errors during crash
  }

  // Exit with error code (systemd/launchd can restart if configured)
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[ERROR] Unhandled Promise Rejection')
  console.error('[ERROR] Reason:', reason)
  // Don't exit - just log for debugging, app can continue
})

// Log MaxListenersExceededWarning to help detect memory leaks during development
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    console.error('[Memory] Potential listener leak detected:', warning.message)
    console.error('[Memory] Stack:', warning.stack)
  }
})

// Privacy: Disable WebRTC to prevent IP leaks
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp')
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy')

// Window bounds persistence
interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const boundsFile = join(app.getPath('userData'), 'window-bounds.json')

function loadWindowBounds(): Partial<WindowBounds> {
  try {
    if (existsSync(boundsFile)) {
      const data = readFileSync(boundsFile, 'utf-8')
      const bounds = JSON.parse(data) as WindowBounds

      // Validate bounds are on a visible display
      const displays = screen.getAllDisplays()
      const isVisible = displays.some((display) => {
        return (
          bounds.x >= display.bounds.x &&
          bounds.x < display.bounds.x + display.bounds.width &&
          bounds.y >= display.bounds.y &&
          bounds.y < display.bounds.y + display.bounds.height
        )
      })

      if (isVisible) {
        return bounds
      }
    }
  } catch (err) {
    console.error('[Window] Failed to load bounds:', err)
  }
  return {}
}

function saveWindowBounds(win: BrowserWindow): void {
  try {
    const bounds: WindowBounds = {
      ...win.getBounds(),
      isMaximized: win.isMaximized(),
    }
    writeFileSync(boundsFile, JSON.stringify(bounds))
  } catch (err) {
    console.error('[Window] Failed to save bounds:', err)
  }
}

function createWindow(): void {
  const savedBounds = loadWindowBounds()

  const mainWindow = new BrowserWindow({
    width: savedBounds.width || 1280,
    height: savedBounds.height || 800,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false  // Main window loads trusted local UI only; BrowserView has sandbox: true for untrusted content
    }
  })

  // Register window with our module for IPC handlers
  setMainWindow(mainWindow)

  // Security: Add Content-Security-Policy for main window (React UI) - production only
  // In dev mode, Vite uses localhost with dynamic scripts which CSP would block
  if (!is.dev) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'"
          ]
        }
      })
    })
  }

  mainWindow.on('ready-to-show', async () => {
    // Restore maximized state
    if (savedBounds.isMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
    // Open DevTools only in dev mode (not preview)
    if (import.meta.env.DEV) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }

    // Auto-connect if enabled
    const { autoConnect } = getSetting('network')
    if (autoConnect) {
      console.log('[App] Auto-connect enabled, starting proxy...')
      try {
        await proxyManager.start()
        initTabManager(mainWindow, proxyManager.getStatus().port)
        await storageManager.start()
        console.log('[App] Auto-connect complete')
        // Notify renderer of connection status
        mainWindow.webContents.send('proxy:status', { status: 'connected', ...proxyManager.getStatus() })
      } catch (error) {
        console.error('[App] Auto-connect failed:', error)
      }
    }
  })

  // Save window bounds on resize/move
  mainWindow.on('resized', () => saveWindowBounds(mainWindow))
  mainWindow.on('moved', () => saveWindowBounds(mainWindow))

  // Context menu for internal pages (ton://)
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    // Text editing options
    if (params.isEditable) {
      menuItems.push(
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: params.editFlags.canCut, click: () => mainWindow.webContents.cut() },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: params.editFlags.canCopy, click: () => mainWindow.webContents.copy() },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: params.editFlags.canPaste, click: () => mainWindow.webContents.paste() },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => mainWindow.webContents.selectAll() }
      )
    } else if (params.selectionText) {
      menuItems.push(
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => mainWindow.webContents.copy() }
      )
    }

    // Link options
    if (params.linkURL) {
      if (menuItems.length > 0) menuItems.push({ type: 'separator' })
      menuItems.push(
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

    // Show menu only if there are items
    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer in development
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // macOS: Set application menu for copy/paste shortcuts
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' }
        ]
      }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  electronApp.setAppUserModelId('com.tonbrowser.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  proxyManager.stop()
  storageManager.stop()

  // Clear browsing data on exit if enabled
  const { clearOnExit } = getSetting('privacy')
  if (clearOnExit) {
    console.log('[App] Clearing browsing data on exit...')
    try {
      const ses = session.fromPartition('persist:ton-browser')
      await ses.clearCache()
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
      })
      console.log('[App] Browsing data cleared')
    } catch (error) {
      console.error('[App] Failed to clear browsing data:', error)
    }
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  proxyManager.stop()
  storageManager.stop()
})
