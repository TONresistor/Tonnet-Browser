/**
 * Main process entry point.
 * Creates the browser window and initializes all services.
 */

import { app, BrowserWindow, shell, screen, session, Menu } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { EventEmitter } from 'events'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { getActiveView } from './windows/tabs'
import { proxyManager } from './proxy/manager'
import { storageManager } from './storage/daemon'
import { setMainWindow } from './windows/main'
import { getSetting } from './settings'
import { initTabManager } from './windows/tabs'
import { historyManager } from './history/manager'
import { logger } from '../shared/logger'
import { buildContextMenu } from './utils/context-menu'

// Memory leak prevention: increase limit for BrowserView tab switches
// Each addBrowserView() adds a 'closed' listener to BrowserWindow
EventEmitter.defaultMaxListeners = 50

// Global error handlers - must be registered early to catch all errors
process.on('uncaughtException', (error: Error) => {
  logger.error('App', `Uncaught Exception: ${error.message}`)
  logger.error('App', `Stack: ${error.stack}`)

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
  logger.error('App', `Unhandled Promise Rejection: ${String(reason)}`)
  // Don't exit - just log for debugging, app can continue
})

// Log MaxListenersExceededWarning to help detect memory leaks during development
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    logger.warn('Memory', `Potential listener leak detected: ${warning.message}`)
    if (warning.stack) {
      logger.warn('Memory', `Stack: ${warning.stack}`)
    }
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
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null

function loadWindowBounds(): Partial<WindowBounds> {
  try {
    if (existsSync(boundsFile)) {
      const data = readFileSync(boundsFile, 'utf-8')
      const bounds = JSON.parse(data) as WindowBounds

      if (
        typeof bounds.x !== 'number' ||
        typeof bounds.y !== 'number' ||
        typeof bounds.width !== 'number' ||
        typeof bounds.height !== 'number'
      ) {
        return {}
      }

      // Validate bounds are on a visible display (top-left corner must be on some display)
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
    logger.error('Window', `Failed to load bounds: ${String(err)}`)
  }
  return {}
}

function saveWindowBounds(win: BrowserWindow): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    try {
      const bounds: WindowBounds = {
        ...win.getBounds(),
        isMaximized: win.isMaximized(),
      }
      writeFile(boundsFile, JSON.stringify(bounds)).catch((err) => {
        logger.error('Window', `Failed to save bounds: ${String(err)}`)
      })
    } catch (err) {
      logger.error('Window', `Failed to save bounds: ${String(err)}`)
    }
  }, 500)
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
      logger.info('App', 'Auto-connect enabled, starting proxy...')
      try {
        await proxyManager.start()
        initTabManager(mainWindow, proxyManager.getStatus().port)
        await storageManager.start()
        logger.info('App', 'Auto-connect complete')
        // Notify renderer of connection status
        mainWindow.webContents.send('proxy:status', { status: 'connected', ...proxyManager.getStatus() })
      } catch (error) {
        logger.error('App', `Auto-connect failed: ${String(error)}`)
        // Notify renderer of connection failure (field name matches ProxyStatus.error)
        mainWindow.webContents.send('proxy:status', {
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })

  // Save window bounds on resize/move
  mainWindow.on('resized', () => saveWindowBounds(mainWindow))
  mainWindow.on('moved', () => saveWindowBounds(mainWindow))

  // Context menu for internal pages (ton://)
  mainWindow.webContents.on('context-menu', (_e, params) => {
    buildContextMenu(params, { webContents: mainWindow.webContents })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const scheme = new URL(details.url).protocol
    if (scheme !== 'https:' && scheme !== 'http:') {
      return { action: 'deny' }
    }
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

    // Intercept Ctrl+Shift+I to open DevTools for active BrowserView (not main window)
    // This prevents DevTools from appearing under the BrowserView overlay
    window.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault()
        const view = getActiveView()
        if (view) {
          // Toggle DevTools for the website's BrowserView
          if (view.webContents.isDevToolsOpened()) {
            view.webContents.closeDevTools()
          } else {
            view.webContents.openDevTools({ mode: 'detach' })
          }
        } else {
          // No active BrowserView, open DevTools for main window (system pages)
          if (window.webContents.isDevToolsOpened()) {
            window.webContents.closeDevTools()
          } else {
            window.webContents.openDevTools({ mode: 'detach' })
          }
        }
      }
    })
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
    logger.info('App', 'Clearing browsing data on exit...')
    try {
      const { getAllSessions } = await import('./windows/tabs')
      const sessions = getAllSessions()

      for (const ses of sessions) {
        await ses.clearCache()
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
        })
      }

      logger.info('App', `Cleared browsing data for ${sessions.length} session(s)`)
    } catch (error) {
      logger.error('App', `Failed to clear browsing data: ${String(error)}`)
    }
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  // Cleanup history before quit
  await historyManager.onAppExit()

  proxyManager.stop()
  storageManager.stop()
})
