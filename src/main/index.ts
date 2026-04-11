/**
 * Main process entry point.
 * Creates the browser window and initializes all services.
 */

import log from '../shared/logger'
import { app, BrowserWindow, shell, screen, Menu, protocol, net, clipboard } from 'electron'
import { join, resolve, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { migrateUserData } from './utils/migrate-userdata'
import { writeFile } from 'fs/promises'
import { EventEmitter } from 'events'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, emitToRenderer } from './ipc/handlers'
import { getActiveView, getAllSessions, cleanupTabManager } from './windows/tabs'
import { setMainWindow } from './windows/main'
import { getSetting } from './settings'
import { startProxySequence } from './proxy/startup'
import { initUpdater } from './updater'
import { createServices, destroyServices, type ServiceRegistry } from './services'
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  WINDOW_BACKGROUND_COLOR,
  CONTEXT_MENU_WIDTH,
  BOUNDS_SAVE_DEBOUNCE_MS,
} from './windows/constants'
import { IPC_CHANNELS } from '../shared/ipc-channels'

// Initialize electron-log IPC bridge so renderer can also log via electron-log
log.initialize()

// Memory leak prevention: increase limit for WebContentsView tab switches
EventEmitter.defaultMaxListeners = 20

// Register custom protocol for serving renderer in production
// MUST be called before app.ready -- silently fails otherwise
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

// Catch uncaught exceptions in the main process -- process state is corrupted, exit after logging
process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE' || error.message === 'write EPIPE') return
  appLog.error(`Uncaught exception: ${String(error)}`)
  // Force-kill child processes to prevent zombies
  if (services) {
    try {
      services.proxyManager.stop().catch(() => {})
      services.storageManager.stop()
    } catch {
      /* ignore */
    }
  }
  process.exit(1)
})

// WM_CLASS for Linux taskbar (display name only, does not affect userData path)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'TON Browser')
}

// App identity: keep "TON Browser" as app.name for safeStorage keyring compatibility.
// Linux libsecret and macOS Keychain use app.name as the key to find the encryption
// secret. Changing it would make existing encrypted wallet data unreadable.
app.setName('TON Browser')

// Force userData to canonical "ton-browser" directory (no spaces, lowercase).
// app.setPath decouples the filesystem path from app.name, so safeStorage
// keeps using "TON Browser" in the keyring while files go to ton-browser/.
{
  const userDataParent = dirname(app.getPath('userData'))
  const canonicalUserData = join(userDataParent, 'ton-browser')
  migrateUserData(canonicalUserData)
  app.setPath('userData', canonicalUserData)
}

// Privacy: Disable WebRTC to prevent IP leaks
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp')
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy')

// Privacy: Prevent DNS leaks outside proxy and disable speculative features
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost')
app.commandLine.appendSwitch('dns-prefetch-disable')
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('no-pings')
app.commandLine.appendSwitch(
  'disable-features',
  'IdleDetection,DirectSockets,WebOTP,DigitalGoods,WebPayments,HttpsUpgrades,NetworkPrediction'
)

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
  }, BOUNDS_SAVE_DEBOUNCE_MS)
}

// Service registry -- populated in app.whenReady()
let services: ServiceRegistry

function createWindow(): void {
  const savedBounds = loadWindowBounds()

  const mainWindow = new BrowserWindow({
    width: savedBounds.width || DEFAULT_WINDOW_WIDTH,
    height: savedBounds.height || DEFAULT_WINDOW_HEIGHT,
    x: savedBounds.x,
    y: savedBounds.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    icon: join(app.getAppPath(), 'resources/icons/icon.png'),
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Register window with our module for IPC handlers
  setMainWindow(mainWindow)
  services.overlayManager.init(mainWindow)

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

    // Auto-connect if enabled -- reuse same progress events as manual connect
    const { autoConnect } = getSetting('network')
    if (autoConnect && !autoConnectStarted) {
      autoConnectStarted = true
      appLog.info('Auto-connect enabled, starting proxy...')
      const sendProgress = (step: number, message: string) => {
        emitToRenderer(IPC_CHANNELS.PROXY_PROGRESS, { step, message })
      }
      // Tell renderer to show loading state
      emitToRenderer('proxy:auto-connect')
      try {
        const tabDeps = {
          overlayManager: services.overlayManager,
          proxyManager: services.proxyManager,
          storageManager: services.storageManager,
          historyManager: services.historyManager,
          contentFilterManager: services.contentFilterManager,
          paymentInterceptor: services.paymentInterceptor,
        }
        await startProxySequence(sendProgress, services.proxyManager, services.storageManager, mainWindow, tabDeps)
        appLog.info('Auto-connect complete')
        // Notify renderer of connection status
        emitToRenderer('proxy:status', { ...services.proxyManager.getStatus(), status: 'connected' })
      } catch (error) {
        appLog.error(`Auto-connect failed: ${String(error)}`)
        // Notify renderer of connection failure (field name matches ProxyStatus.error)
        emitToRenderer('proxy:status', {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })

  // Save window bounds on resize/move
  mainWindow.on('resized', () => saveWindowBounds(mainWindow))
  mainWindow.on('moved', () => saveWindowBounds(mainWindow))

  // Context menu for internal pages (overlay instead of native menu)
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items: Array<{
      id: string
      label: string
      separator?: boolean
      disabled?: boolean
      data?: Record<string, string>
    }> = []

    if (params.isEditable) {
      items.push(
        { id: 'cut', label: 'Cut', disabled: !params.editFlags.canCut },
        { id: 'copy', label: 'Copy', disabled: !params.editFlags.canCopy },
        { id: 'paste', label: 'Paste', disabled: !params.editFlags.canPaste },
        { id: '_sep1', label: '', separator: true },
        { id: 'select-all', label: 'Select All' }
      )
    } else if (params.selectionText) {
      items.push({ id: 'copy', label: 'Copy' })
    }

    if (params.linkURL) {
      if (items.length > 0) items.push({ id: '_sep2', label: '', separator: true })
      items.push({ id: 'copy-link', label: 'Copy Link Address', data: { url: params.linkURL } })
    }

    if (items.length === 0) return

    const visibleItems = items.filter((i) => !i.separator).length
    const separators = items.filter((i) => i.separator).length
    const menuH = visibleItems * 36 + separators * 9 + 8
    const menuW = CONTEXT_MENU_WIDTH

    const [winW, winH] = mainWindow.getContentSize()
    const menuX = Math.max(0, Math.min(params.x, winW - menuW))
    const menuY = Math.max(0, Math.min(params.y, winH - menuH))

    services.overlayManager.show(
      'main-context-menu',
      { x: menuX, y: menuY, width: menuW, height: menuH },
      { type: 'menu', items },
      (actionType, actionData) => {
        switch (actionType) {
          case 'cut':
            mainWindow.webContents.cut()
            break
          case 'copy':
            mainWindow.webContents.copy()
            break
          case 'paste':
            mainWindow.webContents.paste()
            break
          case 'select-all':
            mainWindow.webContents.selectAll()
            break
          case 'copy-link':
            clipboard.writeText((actionData as Record<string, string>).url)
            break
          case 'dismiss':
            break
        }
        services.overlayManager.hide('main-context-menu')
      }
    )
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

  services = createServices()
  registerIpcHandlers(services)

  // Defer wallet + bridge interceptor init until WS bridge is ready (proxy must be running first)
  services.proxyManager.once('ws-bridge-ready', () => {
    services.walletManager.init().catch((e) => log.error('Wallet init failed:', e))
    services.paymentPolicyStore.init().catch((e) => log.error('Payment policy init failed:', e))
    services.bridgeInterceptor.init()
  })
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

    // Clear bookmarks file (privacy: leave no browsing trace)
    try {
      const { getBookmarksFile } = await import('./bookmarks')
      const { unlinkSync, existsSync } = await import('fs')
      const file = getBookmarksFile()
      if (existsSync(file)) {
        unlinkSync(file)
        log.info('Cleared bookmarks file')
      }
    } catch (error) {
      log.error(`Failed to clear bookmarks: ${String(error)}`)
    }
  }

  cleanupTabManager()
  await destroyServices(services)
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

  // Cleanup history before quit -- must await, so use Promise chain
  services.historyManager
    .onAppExit()
    .then(() => runCleanup())
    .catch(() => runCleanup())
    .finally(() => app.quit())
})
