/**
 * Main process entry point.
 * Creates the browser window and initializes all services.
 */

import log from '../shared/logger'
import { app, BrowserWindow, shell, Menu, protocol, net } from 'electron'
import { join, resolve, dirname, sep } from 'path'
import { mkdirSync } from 'fs'
import { migrateUserData } from './utils/migrate-userdata'
import { EventEmitter } from 'events'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers, emitToRenderer } from './ipc/handlers'
import { getActiveView } from './windows/tabs'
import { setMainWindow } from './windows/main'
import { getSetting } from './settings'
import { startProxySequence } from './proxy/startup'
import { initUpdater } from './updater'
import { createServices, type ServiceRegistry } from './services'
import {
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  WINDOW_BACKGROUND_COLOR,
} from './windows/constants'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import { loadWindowBounds, saveWindowBounds, flushWindowBoundsOnQuit } from './windows/bounds'
import { autostartCocoonIfEnabled } from './cocoon/autostart'
import { runCleanup, isCleanupInProgress } from './app-cleanup'
import { reapStaleDaemons, installDaemonSignalHandlers } from './daemon-registry'
import { setupMainContextMenu } from './windows/main-context-menu'

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

/**
 * Run a deferred startup step (sync or async), logging on failure instead of
 * throwing, so one service failing to init/start cannot abort the rest of the
 * boot sequence. DRY: unifies the bare calls and ad-hoc .catch() at the
 * ws-bridge-ready hook into one guarded path.
 */
function safeStartup(label: string, run: () => void | Promise<unknown>): void {
  try {
    const result = run()
    if (result instanceof Promise) result.catch((e) => log.error(`${label} failed:`, e))
  } catch (e) {
    log.error(`${label} failed:`, e)
  }
}
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

// Kill native daemons on POSIX signals (dev restart, terminal close, OS
// shutdown) -- Electron's before-quit only runs on a graceful quit, so without
// this the daemons would orphan and keep holding their ports.
installDaemonSignalHandlers()

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
  // Redirect logs path before the first log write (migrateUserData logs).
  // Without this, electron-log resolves app.getPath('logs') via app.name and
  // writes to ~/.config/TON Browser/logs, which does not exist on fresh installs.
  const canonicalLogs = join(canonicalUserData, 'logs')
  mkdirSync(canonicalLogs, { recursive: true })
  app.setPath('logs', canonicalLogs)
  log.transports.file.resolvePathFn = () => join(canonicalLogs, 'main.log')
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

// Window bounds persistence lives in ./windows/bounds (OPP-65 extraction).

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
  initUpdater()

  // Security: Add Content-Security-Policy for main window (React UI)
  // Dev mode uses Report-Only to avoid breaking HMR/hot reload
  const cspPolicy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' http://127.0.0.1:*"
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

    // Auto-connect if enabled -- reuse same progress events as manual connect
    const { autoConnect } = getSetting('network')
    if (autoConnect && !autoConnectStarted) {
      autoConnectStarted = true
      appLog.info('Auto-connect enabled, starting proxy...')
      const sendProgress = (step: number, message: string) => {
        emitToRenderer(IPC_CHANNELS.PROXY_PROGRESS, { step, message })
      }
      // Tell renderer to show loading state
      emitToRenderer(IPC_CHANNELS.PROXY_AUTO_CONNECT)
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
        emitToRenderer(IPC_CHANNELS.PROXY_STATUS, { ...services.proxyManager.getStatus(), status: 'connected' })
      } catch (error) {
        appLog.error(`Auto-connect failed: ${String(error)}`)
        // Notify renderer of connection failure (field name matches ProxyStatus.error)
        emitToRenderer(IPC_CHANNELS.PROXY_STATUS, {
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
  setupMainContextMenu(mainWindow, services.overlayManager)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      const ALLOWED_EXTERNAL_HOSTS = ['github.com', 'resistance.dog']
      const hostAllowed = ALLOWED_EXTERNAL_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))
      if (url.protocol === 'https:' && hostAllowed) {
        shell.openExternal(url.href)
      }
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

// Single-instance lock: a second launch would spawn duplicate daemons that
// collide on the fixed ports (proxy 8080, bridge 8081, storage 5555) and
// deadlock. The loser exits immediately (app.exit skips before-quit, whose
// cleanup touches services that this instance never built); the winner just
// focuses its existing window when another launch is attempted.
if (!app.requestSingleInstanceLock()) {
  app.exit(0)
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  // Reap any daemons orphaned by a previous run before we spawn fresh ones.
  reapStaleDaemons()

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

  // Serve files via app:// protocol in production
  // Replaces file:// which is blocked by grantFileProtocolExtraPrivileges fuse
  // Routed by URL hostname:
  //   app://bundle/*  → out/renderer/ (main window)
  //   app://overlay/* → resources/overlay/ (overlay WebContentsViews)
  const rendererPath = resolve(__dirname, '../renderer')
  const overlayPath = resolve(__dirname, '../../resources/overlay')
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const basePath = url.hostname === 'overlay' ? overlayPath : rendererPath
    let pathname = url.pathname
    if (pathname === '/') {
      pathname = url.hostname === 'overlay' ? '/overlay.html' : '/index.html'
    }

    const filePath = resolve(basePath, pathname.slice(1))

    // Path traversal guard. Require a separator after basePath so a sibling
    // directory (rendererEVIL/) cannot pass a bare startsWith(basePath) prefix.
    if (filePath !== basePath && !filePath.startsWith(basePath + sep)) {
      appLog.warn(`Blocked path traversal: ${pathname}`)
      return new Response('Forbidden', { status: 403 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })

  services = createServices()
  registerIpcHandlers(services)
  services.tonConnectService.init()

  // Defer wallet + bridge interceptor init until WS bridge is ready (proxy must be running first)
  services.proxyManager.once('ws-bridge-ready', () => {
    safeStartup('Wallet init', () => services.walletManager.init())
    safeStartup('Payment policy init', () => services.paymentPolicyStore.init())
    safeStartup('Bridge interceptor init', () => services.bridgeInterceptor.init())
    // Cocoon drivers need the bridge to do work, so start them here rather than
    // at construction (avoids an immediate disk-reading tick before bridge ready).
    safeStartup('Withdraw driver start', () => services.withdrawDriver.start())
    safeStartup('Recovery driver start', () => services.recoveryDriver.start())
    safeStartup('Cocoon autostart', () => autostartCocoonIfEnabled(services))
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', async () => {
  if (isCleanupInProgress()) return

  await runCleanup(services)

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
  flushWindowBoundsOnQuit()

  // Cleanup history before quit -- must await, so use Promise chain
  services.historyManager
    .onAppExit()
    .then(() => runCleanup(services))
    .catch(() => runCleanup(services))
    .finally(() => app.quit())
})
