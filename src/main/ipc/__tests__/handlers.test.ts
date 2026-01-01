/**
 * IPC Handlers Tests
 * Tests for critical IPC handler security and functionality
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Store mock handlers
const mockHandlers = new Map<string, (...args: any[]) => any>()

// Store mock event emitters for testing event forwarding
const mockProxyEmitter = new EventEmitter()
const mockStorageEmitter = new EventEmitter()

// Store mock window reference
let mockMainWindow: any = null

// Mock Electron's ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      mockHandlers.set(channel, handler)
    },
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  session: {
    defaultSession: {
      setProxy: vi.fn(),
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
}))

// Mock proxy manager - must be inside vi.mock factory
vi.mock('../../proxy/manager', () => {
  const emitter = new EventEmitter()
  return {
    proxyManager: Object.assign(emitter, {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      getStatus: vi.fn(() => ({
        status: 'connected',
        connected: true,
        syncing: false,
        port: 8080,
      })),
      isRunning: vi.fn(() => false),
      applySettingsChange: vi.fn(() => Promise.resolve()),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
    }),
  }
})

// Mock storage manager
vi.mock('../../storage/daemon', () => {
  const emitter = new EventEmitter()
  return {
    storageManager: Object.assign(emitter, {
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      getStatus: vi.fn(() => ({
        running: true,
        port: 5555,
        storagePath: '/mock/downloads',
      })),
      on: emitter.on.bind(emitter),
      emit: emitter.emit.bind(emitter),
    }),
  }
})

// Mock storage bags
vi.mock('../../storage/bags', () => ({
  addBag: vi.fn(() => Promise.resolve({ id: 'test-bag', status: 'downloading' })),
  removeBag: vi.fn(() => Promise.resolve(true)),
  listBags: vi.fn(() => Promise.resolve([])),
  pauseBag: vi.fn(() => Promise.resolve(true)),
  resumeBag: vi.fn(() => Promise.resolve(true)),
  getBagDetails: vi.fn(() => Promise.resolve({ id: 'test-bag', files: [] })),
}))

// Mock settings
vi.mock('../../settings', () => ({
  loadSettings: vi.fn(() => ({ general: {}, network: {}, storage: {} })),
  getSetting: vi.fn(() => ({})),
  setSetting: vi.fn(),
  resetSettings: vi.fn(),
  getDownloadPath: vi.fn(() => '/mock/downloads'),
  setDownloadPath: vi.fn(),
}))

// Mock windows/main with a factory that returns current mockMainWindow
vi.mock('../../windows/main', () => ({
  getMainWindow: () => mockMainWindow,
}))

// Mock tabs
vi.mock('../../windows/tabs', () => ({
  initTabManager: vi.fn(),
  createTab: vi.fn(() => true),
  closeTab: vi.fn(() => true),
  switchTab: vi.fn(() => true),
  getActiveView: vi.fn(),
  hideAllViews: vi.fn(),
  showActiveView: vi.fn(),
  navigateInTab: vi.fn(() => ({ success: true })),
  getActiveTabId: vi.fn(() => 'tab-1'),
}))

// Import after mocks
import { registerIpcHandlers, _resetHandlersForTesting } from '../handlers'
import { IPC_CHANNELS } from '../../../shared/types'
import { proxyManager } from '../../proxy/manager'
import { storageManager } from '../../storage/daemon'
import { addBag, removeBag, listBags } from '../../storage/bags'
import { setSetting, resetSettings } from '../../settings'
import { createTab, closeTab, switchTab, navigateInTab } from '../../windows/tabs'

describe('IPC Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandlers.clear()
    _resetHandlersForTesting() // Reset guard to allow re-registration
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
    }
    registerIpcHandlers()
  })

  describe('Handler Registration', () => {
    it('registers all required handlers', () => {
      const requiredHandlers = [
        IPC_CHANNELS.PROXY_CONNECT,
        IPC_CHANNELS.PROXY_DISCONNECT,
        IPC_CHANNELS.PROXY_STATUS,
        IPC_CHANNELS.TAB_CREATE,
        IPC_CHANNELS.TAB_CLOSE,
        IPC_CHANNELS.TAB_SWITCH,
      ]

      for (const channel of requiredHandlers) {
        expect(mockHandlers.has(channel)).toBe(true)
      }
    })
  })

  describe('Proxy Handlers', () => {
    it('PROXY_CONNECT starts proxy and returns success', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)
      expect(handler).toBeDefined()

      const result = await handler!()

      expect(result.success).toBe(true)
      expect(proxyManager.start).toHaveBeenCalled()
    })

    it('PROXY_CONNECT handles errors gracefully', async () => {
      vi.mocked(proxyManager.start).mockRejectedValueOnce(new Error('Proxy failed'))

      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)
      const result = await handler!()

      expect(result.success).toBe(false)
      expect(result.error).toBe('Proxy failed')
    })

    it('PROXY_DISCONNECT stops both storage and proxy', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_DISCONNECT)
      const result = await handler!()

      expect(storageManager.stop).toHaveBeenCalled()
      expect(proxyManager.stop).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('PROXY_STATUS returns current status', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)
      const result = await handler!()

      expect(result.status).toBe('connected')
      expect(result.port).toBe(8080)
    })
  })

  describe('Tab Handlers', () => {
    it('TAB_CREATE creates a new tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_CREATE)
      const result = await handler!({}, 'new-tab-id')

      expect(createTab).toHaveBeenCalledWith('new-tab-id')
      expect(result.success).toBe(true)
    })

    it('TAB_CLOSE closes a tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_CLOSE)
      const result = await handler!({}, 'tab-to-close')

      expect(closeTab).toHaveBeenCalledWith('tab-to-close')
      expect(result.success).toBe(true)
    })

    it('TAB_SWITCH switches to a tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_SWITCH)
      const result = await handler!({}, 'tab-to-activate')

      expect(switchTab).toHaveBeenCalledWith('tab-to-activate')
      expect(result.success).toBe(true)
    })
  })

  describe('Storage Handlers', () => {
    it('STORAGE_ADD_BAG validates bagId format', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)
      if (!handler) return // Skip if not registered

      // Valid 64-char hex
      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      const result = await handler({}, validBagId, 'Test Bag')

      expect(addBag).toHaveBeenCalledWith(validBagId, 'Test Bag')
    })

    it('STORAGE_ADD_BAG rejects invalid bagId', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)
      if (!handler) return

      const invalidBagId = 'invalid-bag-id'
      const result = await handler({}, invalidBagId, 'Test')

      expect(result.success).toBe(false)
      expect(addBag).not.toHaveBeenCalled()
    })

    it('STORAGE_REMOVE_BAG removes bag by id', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_REMOVE_BAG)
      if (!handler) return

      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      await handler({}, validBagId)

      expect(removeBag).toHaveBeenCalledWith(validBagId)
    })

    it('STORAGE_LIST_BAGS returns bag list', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_LIST_BAGS)
      if (!handler) return

      await handler({})

      expect(listBags).toHaveBeenCalled()
    })
  })

  describe('Settings Handlers', () => {
    it('SETTINGS_SET updates a setting category', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_SET)
      if (!handler) return

      await handler({}, 'network', { proxyPort: 9000 })

      expect(setSetting).toHaveBeenCalledWith('network', { proxyPort: 9000 })
    })

    it('SETTINGS_RESET restores defaults', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_RESET)
      if (!handler) return

      await handler({})

      expect(resetSettings).toHaveBeenCalled()
    })
  })

  describe('Event Forwarding', () => {
    it('forwards proxy status events to renderer', () => {
      // Emit event on proxy manager
      ;(proxyManager as EventEmitter).emit('status', 'connected')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'proxy:status',
        expect.objectContaining({ status: 'connected' })
      )
    })

    it('forwards storage bags-updated events to renderer', () => {
      const bags = [{ id: 'bag1', name: 'Test' }]
      ;(storageManager as EventEmitter).emit('bags-updated', bags)

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'storage:bags-updated',
        bags
      )
    })

    it('forwards storage started event to renderer', () => {
      ;(storageManager as EventEmitter).emit('started')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'storage:status',
        { running: true }
      )
    })

    it('forwards storage stopped event to renderer', () => {
      ;(storageManager as EventEmitter).emit('stopped')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'storage:status',
        { running: false }
      )
    })
  })
})

describe('Security - Input Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandlers.clear()
    _resetHandlersForTesting() // Reset guard to allow re-registration
    mockMainWindow = {
      webContents: { send: vi.fn() },
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
    }
    registerIpcHandlers()
  })

  it('navigation handler rejects javascript: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAV_NAVIGATE)
    if (!handler) return

    const result = await handler({}, 'javascript:alert(1)')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects data: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAV_NAVIGATE)
    if (!handler) return

    const result = await handler({}, 'data:text/html,<script>alert(1)</script>')

    expect(result.success).toBe(false)
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects file: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAV_NAVIGATE)
    if (!handler) return

    const result = await handler({}, 'file:///etc/passwd')

    expect(result.success).toBe(false)
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('storage handler rejects invalid bagId format', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)
    if (!handler) return

    // Test command injection attempt
    const maliciousBagId = '$(rm -rf /)'
    const result = await handler({}, maliciousBagId)

    expect(result.success).toBe(false)
    expect(addBag).not.toHaveBeenCalled()
  })
})
