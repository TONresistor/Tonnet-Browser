/**
 * Main process entry point.
 * Creates the browser window and initializes all services.
 */

import log from '../shared/logger'
import { app, BrowserWindow, shell, screen, Menu, protocol, net } from 'electron'
import { join, resolve } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { EventEmitter } from 'events'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/handlers'
import { getActiveView } from './windows/tabs'
import { proxyManager } from './proxy/manager'
import { storageManager } from './storage/daemon'
import { setMainWindow } from './windows/main'
import { getSetting } from './settings'
import { historyManager } from './history/manager'
import { startProxySequence } from './proxy/startup'
import { buildContextMenu } from './utils/context-menu'
import { initUpdater } from './updater'

// Initialize electron-log IPC bridge so renderer can also log via electron-log
log.initialize()

// Memory leak prevention: increase limit for WebContentsView tab switches
EventEmitter.defaultMaxListeners = 20

// Register custom protocol for serving renderer in production
// MUST be called before app.ready — silently fails otherwise
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
])

// Log MaxListenersExceededWarning to help detect memory leaks during development
const appLog = log.scope('app')
process.on('warning', (warning) => {
  if (warning.name === 'MaxListenersExceededWarning') {
    appLog.warn(`Potential listener leak detected: ${warning.message}`)
    if (warning.stack) {
      appLog.warn(`Stack: ${warning.stack}`)
    }
  }
})

// Catch unhandled promise rejections in the main process
process.on('unhandledRejection', (reason) => {
  appLog.error(`Unhandled promise rejection: ${String(reason)}`)
})

// Catch uncaught exceptions in the main process — process state is corrupted, exit after logging
process.on('uncaughtException', (error) => {
  appLog.error(`Uncaught exception: ${String(error)}`)
  process.exit(1)
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
    appLog.error(`Failed to load bounds: ${String(err)}`)
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
        appLog.error(`Failed to save bounds: ${String(err)}`)
      })
    } catch (err) {
      appLog.error(`Failed to save bounds: ${String(err)}`)
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
      sandbox: false, // Main window loads trusted local UI only; WebContentsView has sandbox: true for untrusted content
    },
  })

  // Register window with our module for IPC handlers
  setMainWindow(mainWindow)

  // Initialize manual update checker
  initUpdater(mainWindow)

  // Security: Add Content-Security-Policy for main window (React UI)
  // Dev mode uses Report-Only to avoid breaking HMR/hot reload
  const cspPolicy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'"
  const cspHeader = is.dev ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        [cspHeader]: [cspPolicy],
      },
    })
  })

  let autoConnectStarted = false
  mainWindow.on('ready-to-show', async () => {
    // Restore maximized state
    if (savedBounds.isMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
    // Open DevTools only in dev mode
    if (is.dev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }

    // Auto-connect if enabled — reuse same progress events as manual connect
    const { autoConnect } = getSetting('network')
    if (autoConnect && !autoConnectStarted) {
      autoConnectStarted = true
      appLog.info('Auto-connect enabled, starting proxy...')
      const sendProgress = (step: number, message: string) => {
        mainWindow.webContents.send('proxy:progress', { step, message })
      }
      // Tell renderer to show loading state
      mainWindow.webContents.send('proxy:auto-connect')
      try {
        await startProxySequence(sendProgress, proxyManager, storageManager, mainWindow)
        appLog.info('Auto-connect complete')
        // Notify renderer of connection status
        mainWindow.webContents.send('proxy:status', { ...proxyManager.getStatus(), status: 'connected' })
      } catch (error) {
        appLog.error(`Auto-connect failed: ${String(error)}`)
        // Notify renderer of connection failure (field name matches ProxyStatus.error)
        mainWindow.webContents.send('proxy:status', {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
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
    try {
      const scheme = new URL(details.url).protocol
      if (scheme !== 'https:' && scheme !== 'http:') {
        return { action: 'deny' }
      }
      shell.openExternal(details.url)
    } catch (err) {
      appLog.error(`setWindowOpenHandler: invalid URL "${details.url}": ${String(err)}`)
    }
    return { action: 'deny' }
  })

  // HMR for renderer in development
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('app://bundle/index.html')
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
          { role: 'quit' },
        ],
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
          { role: 'selectAll' },
        ],
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
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
      },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  electronApp.setAppUserModelId('com.tonbrowser.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)

    // Intercept Ctrl+Shift+I (or Cmd+Option+I on macOS) to open DevTools for active WebContentsView (not main window)
    // This prevents DevTools from appearing under the WebContentsView overlay
    window.webContents.on('before-input-event', (event, input) => {
      const isDevToolsShortcut =
        (input.control && input.shift && input.key.toLowerCase() === 'i') ||
        (process.platform === 'darwin' && input.meta && input.alt && input.key.toLowerCase() === 'i')
      if (isDevToolsShortcut) {
        event.preventDefault()
        const view = getActiveView()
        if (view) {
          // Toggle DevTools for the website's WebContentsView
          if (view.webContents.isDevToolsOpened()) {
            view.webContents.closeDevTools()
          } else {
            view.webContents.openDevTools({ mode: 'detach' })
          }
        } else {
          // No active WebContentsView, open DevTools for main window (system pages)
          if (window.webContents.isDevToolsOpened()) {
            window.webContents.closeDevTools()
          } else {
            window.webContents.openDevTools({ mode: 'detach' })
          }
        }
      }
    })
  })

  // Serve renderer files via app:// protocol in production
  // Replaces file:// which is blocked by grantFileProtocolExtraPrivileges fuse
  const rendererPath = resolve(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    let { pathname } = new URL(request.url)
    if (pathname === '/') pathname = '/index.html'

    const filePath = resolve(rendererPath, pathname.slice(1))

    // Path traversal guard
    if (!filePath.startsWith(rendererPath)) {
      appLog.warn(`Blocked path traversal: ${pathname}`)
      return new Response('Forbidden', { status: 403 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

let isCleaningUp = false

async function runCleanup(): Promise<void> {
  if (isCleaningUp) return
  isCleaningUp = true

  // Clear browsing data on exit if enabled
  const { clearOnExit } = getSetting('privacy')
  if (clearOnExit) {
    log.info('Clearing browsing data on exit...')
    try {
      const { getAllSessions } = await import('./windows/tabs')
      const sessions = getAllSessions()

      for (const ses of sessions) {
        await ses.clearCache()
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
        })
      }

      log.info(`Cleared browsing data for ${sessions.length} session(s)`)
    } catch (error) {
      log.error(`Failed to clear browsing data: ${String(error)}`)
    }
  }

  proxyManager.stop()
  storageManager.stop()
}

app.on('window-all-closed', async () => {
  if (isCleaningUp) return

  await runCleanup()

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true

  // Flush pending window bounds save synchronously before quit
  if (saveBoundsTimer) {
    clearTimeout(saveBoundsTimer)
    saveBoundsTimer = null
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      try {
        const bounds = { ...wins[0].getBounds(), isMaximized: wins[0].isMaximized() }
        writeFileSync(boundsFile, JSON.stringify(bounds))
      } catch (err) {
        log.error(`Failed to flush bounds on quit: ${String(err)}`)
      }
    }
  }

  // Cleanup history before quit — must await, so use Promise chain
  historyManager
    .onAppExit()
    .then(() => runCleanup())
    .catch(() => runCleanup())
    .finally(() => app.quit())
})
