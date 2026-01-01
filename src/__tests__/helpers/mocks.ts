/**
 * Shared mocks for Electron and Node.js APIs
 * Used across all test files - DO NOT DUPLICATE
 */
import { vi } from 'vitest'
import { EventEmitter } from 'events'

// ============================================
// ELECTRON MOCKS
// ============================================

export const createMockWebContents = () => ({
  send: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeAllListeners: vi.fn(),
  loadURL: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn(),
  stop: vi.fn(),
  openDevTools: vi.fn(),
  setZoomFactor: vi.fn(),
  getZoomFactor: vi.fn(() => 1),
  navigationHistory: {
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    goBack: vi.fn(),
    goForward: vi.fn(),
  },
})

export const createMockBrowserWindow = () => ({
  webContents: createMockWebContents(),
  on: vi.fn(),
  once: vi.fn(),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 800 })),
  getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 720 })),
  addBrowserView: vi.fn(),
  removeBrowserView: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  minimize: vi.fn(),
  maximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  close: vi.fn(),
})

export const createMockBrowserView = () => ({
  webContents: createMockWebContents(),
  setBounds: vi.fn(),
})

export const createMockSession = () => ({
  setProxy: vi.fn().mockResolvedValue(undefined),
  setPermissionRequestHandler: vi.fn(),
  webRequest: {
    onBeforeSendHeaders: vi.fn(),
  },
  clearCache: vi.fn().mockResolvedValue(undefined),
  clearStorageData: vi.fn().mockResolvedValue(undefined),
  fromPartition: vi.fn(),
})

export const createMockDialog = () => ({
  showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/mock/path'] }),
  showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
})

export const createMockMenu = () => ({
  buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  popup: vi.fn(),
})

export const createMockApp = () => ({
  getPath: vi.fn((name: string) => {
    const paths: Record<string, string> = {
      userData: '/mock/userData',
      home: '/mock/home',
      temp: '/mock/temp',
    }
    return paths[name] || `/mock/${name}`
  }),
  quit: vi.fn(),
  on: vi.fn(),
  whenReady: vi.fn().mockResolvedValue(undefined),
})

// ============================================
// CHILD PROCESS MOCKS
// ============================================

export const createMockChildProcess = () => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { write: ReturnType<typeof vi.fn> }
    pid: number
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: vi.fn() }
  proc.pid = 12345
  proc.kill = vi.fn(() => true)
  return proc
}

// ============================================
// HTTP MOCKS
// ============================================

export const createMockHttpResponse = (statusCode = 200, data = '') => {
  const res = new EventEmitter() as EventEmitter & { statusCode: number }
  res.statusCode = statusCode
  // Simulate async data emission
  setTimeout(() => {
    res.emit('data', Buffer.from(data))
    res.emit('end')
  }, 0)
  return res
}

export const createMockHttpRequest = () => {
  const req = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  req.write = vi.fn()
  req.end = vi.fn()
  req.destroy = vi.fn()
  return req
}

// ============================================
// FILE SYSTEM MOCKS
// ============================================

export const createMockFs = () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => true, isFile: () => false })),
})
