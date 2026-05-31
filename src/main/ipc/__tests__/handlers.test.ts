/**
 * IPC Handlers Tests
 * Tests for critical IPC handler security and functionality
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Store mock handlers
const mockHandlers = new Map<string, (...args: any[]) => any>()

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
    fromPartition: vi.fn(() => ({
      clearCache: vi.fn(() => Promise.resolve()),
      clearStorageData: vi.fn(() => Promise.resolve()),
    })),
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
  shell: {
    openPath: vi.fn(() => Promise.resolve('')),
    showItemInFolder: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/tonnet-test'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  },
  net: {
    fetch: vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
  },
  IpcMainInvokeEvent: {},
}))

// Mock proxy manager (class export only, singleton removed)
vi.mock('../../proxy/manager', () => ({
  ProxyManager: vi.fn(),
}))

// Mock storage manager (class export only, singleton removed)
vi.mock('../../storage/daemon', () => ({
  StorageManager: vi.fn(),
}))

// Mock storage bags
vi.mock('../../storage/bags', () => ({
  addBag: vi.fn(() => Promise.resolve({ id: 'test-bag', status: 'downloading' })),
  removeBag: vi.fn(() => Promise.resolve(true)),
  listBags: vi.fn(() => Promise.resolve([])),
  pauseBag: vi.fn(() => Promise.resolve(true)),
  resumeBag: vi.fn(() => Promise.resolve(true)),
  getBagDetails: vi.fn(() => Promise.resolve({ id: 'test-bag', files: [] })),
  setBagsStorageManager: vi.fn(),
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
  createTab: vi.fn(() => Promise.resolve(true)),
  closeTab: vi.fn(() => true),
  switchTab: vi.fn(() => true),
  getActiveView: vi.fn(),
  hideAllViews: vi.fn(),
  showActiveView: vi.fn(),
  navigateInTab: vi.fn(() => Promise.resolve(true)),
  getActiveTabId: vi.fn(() => 'tab-1'),
  onPrivacySettingsChanged: vi.fn(),
  onAppearanceSettingsChanged: vi.fn(),
  updateSidebarWidth: vi.fn(),
}))

// Mock content filter manager
vi.mock('../../content-filter/filter-manager', () => ({
  contentFilterManager: {
    setEnabled: vi.fn(),
    setWhitelist: vi.fn(),
    setCategoryEnabled: vi.fn(),
  },
}))

// Mock history manager
vi.mock('../../history/manager', () => ({
  historyManager: {
    changeMode: vi.fn(() => Promise.resolve({ success: true })),
    search: vi.fn(() => []),
    getRecent: vi.fn(() => []),
    getTopVisited: vi.fn(() => []),
    getByDateRange: vi.fn(() => []),
    deleteEntry: vi.fn(() => true),
    deleteByPattern: vi.fn(() => 0),
    clear: vi.fn(),
    getStats: vi.fn(() => ({ total: 0, mode: 'memory', isLocked: false })),
    hasPersistentFile: vi.fn(() => false),
  },
  HistoryMode: { MEMORY: 'memory', PERSISTENT: 'persistent' },
}))

// Mock IPC error handler - wraps handler with try/catch like the real implementation
vi.mock('../error-handler', () => ({
  handleWithErrors: (channel: string, handler: (...args: any[]) => any) => {
    mockHandlers.set(channel, async (...args: any[]) => {
      try {
        return await handler(...args)
      } catch (err: any) {
        return { success: false, error: err.message || 'Unknown error' }
      }
    })
  },
  ipcErrorHandler: {
    logError: vi.fn(),
  },
}))

// Mock validation
vi.mock('../validation', () => {
  class MockRateLimiter {
    check() {
      return true
    }
  }
  return {
    isValidNavigationUrl: vi.fn((url: string) => {
      try {
        const parsed = new URL(url)
        const blocked = ['javascript:', 'data:', 'file:', 'vbscript:']
        if (blocked.includes(parsed.protocol)) {
          return { valid: false, error: `Blocked scheme: ${parsed.protocol}` }
        }
        return { valid: true }
      } catch {
        return { valid: false, error: 'Invalid URL' }
      }
    }),
    isValidBagId: vi.fn((id: string) => /^[a-fA-F0-9]{64}$/.test(id)),
    isValidDownloadPath: vi.fn(() => ({ valid: true })),
    RateLimiter: MockRateLimiter,
  }
})

// Mock wallet manager
vi.mock('../../wallet/manager', () => ({
  WalletManager: vi.fn(),
}))

// Mock wallet history
vi.mock('../../wallet/history', () => ({
  WalletHistoryManager: vi.fn(),
}))

// Mock payment interceptor
vi.mock('../../wallet/payment-interceptor', () => ({
  PaymentInterceptor: vi.fn(),
}))

// Mock payment policy
vi.mock('../../wallet/payment-policy', () => ({
  PaymentPolicyStore: vi.fn(),
}))

// Mock overlay manager
vi.mock('../../windows/overlay-manager', () => ({
  OverlayManager: vi.fn(),
}))

// Mock bridge interceptor
vi.mock('../../bridge/permission-interceptor', () => ({
  BridgePermissionInterceptor: vi.fn(),
}))

// Mock bridge permission store
vi.mock('../../bridge/permission-store', () => ({
  BridgePermissionStore: vi.fn(),
}))

// Mock cocoon wallet module (used by new COCOON_WALLET_* handlers)
vi.mock('../../cocoon/wallet', () => ({
  hasCocoonWallet: vi.fn(() => Promise.resolve(false)),
  generateCocoonWallet: vi.fn(() => Promise.resolve({ ownerAddress: 'EQOwner', nodeAddress: 'EQNode', mnemonic: [] })),
  getCocoonWalletInfo: vi.fn(() => Promise.resolve(null)),
  exportCocoonMnemonic: vi.fn(() => Promise.resolve([])),
  deleteCocoonWallet: vi.fn(() => Promise.resolve()),
  loadCocoonWallet: vi.fn(() => Promise.resolve(null)),
  markSetupComplete: vi.fn(() => Promise.resolve()),
}))

// Mock cocoon setup module (used by COCOON_SETUP_* handlers)
vi.mock('../../cocoon/setup', () => ({
  getOwnerBalance: vi.fn(() => Promise.resolve(0n)),
  getCocoonWalletBalance: vi.fn(() => Promise.resolve(0n)),
  fundCocoonFromOwner: vi.fn(() => Promise.resolve({ bocHash: 'hash', seqno: 0, sentAmount: 0n })),
}))

// Mock cocoon platform (used by COCOON_AVAILABILITY handler)
vi.mock('../../cocoon/platform', () => ({
  checkCocoonAvailability: vi.fn(() => ({ available: false, reason: 'platform', message: 'Linux only' })),
}))

// Import after mocks
import { registerIpcHandlers, _resetHandlersForTesting } from '../handlers'
import { IPC_CHANNELS } from '../../../shared/types'
import { addBag, removeBag } from '../../storage/bags'
import { setSetting, resetSettings } from '../../settings'
import { createTab, closeTab, switchTab, navigateInTab } from '../../windows/tabs'
import type { ServiceRegistry } from '../../services'
import {
  hasCocoonWallet,
  generateCocoonWallet,
  getCocoonWalletInfo,
  exportCocoonMnemonic,
  deleteCocoonWallet,
  loadCocoonWallet,
  markSetupComplete,
} from '../../cocoon/wallet'
import { getOwnerBalance, getCocoonWalletBalance, fundCocoonFromOwner } from '../../cocoon/setup'

// Build mock service registry from the mock emitters
const mockProxyManager = (() => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
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
    restart: vi.fn(() => Promise.resolve()),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  })
})()

const mockStorageManager = (() => {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    getStatus: vi.fn(() => ({
      running: true,
      port: 5555,
      storagePath: '/mock/downloads',
    })),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  })
})()

function createMockRegistry(): ServiceRegistry {
  return {
    secureStorage: { isAvailable: () => false, encrypt: vi.fn(), decrypt: vi.fn(), getBackendName: () => 'mock' },
    proxyManager: mockProxyManager as any,
    storageManager: mockStorageManager as any,
    walletManager: {
      on: vi.fn(),
      getState: vi.fn(() => ({ isCreated: false })),
      setAutoLockMinutes: vi.fn(),
      getBridgeClient: vi.fn(() => null),
    } as any,
    walletHistoryManager: { add: vi.fn(), getRecent: vi.fn(), merge: vi.fn(), clear: vi.fn() } as any,
    paymentInterceptor: { approvePayment: vi.fn(), rejectPayment: vi.fn(), registerOnSession: vi.fn() } as any,
    paymentPolicyStore: { destroy: vi.fn(), init: vi.fn() } as any,
    overlayManager: {
      show: vi.fn(),
      hide: vi.fn(),
      hideAll: vi.fn(),
      updateBounds: vi.fn(),
      isOverlayView: vi.fn(() => false),
      handleAction: vi.fn(() => false),
      getOverlayId: vi.fn(() => null),
      updateTheme: vi.fn(),
      destroy: vi.fn(),
      init: vi.fn(),
    } as any,
    bridgeInterceptor: { handleRequest: vi.fn(), init: vi.fn(), destroy: vi.fn() } as any,
    bridgePermissionStore: { getAllPermissions: vi.fn(() => []), revokePermission: vi.fn() } as any,
    historyManager: {
      changeMode: vi.fn(() => Promise.resolve({ success: true })),
      search: vi.fn(() => []),
      getRecent: vi.fn(() => []),
      getTopVisited: vi.fn(() => []),
      getByDateRange: vi.fn(() => []),
      deleteEntry: vi.fn(() => true),
      deleteByPattern: vi.fn(() => 0),
      clear: vi.fn(),
      getStats: vi.fn(() => ({ total: 0, mode: 'memory', isLocked: false })),
      hasPersistentFile: vi.fn(() => false),
    } as any,
    contentFilterManager: {
      setEnabled: vi.fn(),
      setWhitelist: vi.fn(),
      setCategoryEnabled: vi.fn(),
      applySettings: vi.fn(),
    } as any,
    cocoonManager: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        getState: vi.fn(() => ({ kind: 'stopped' })),
        getHttpPort: vi.fn(() => 10000),
        start: vi.fn(() => Promise.resolve()),
        stop: vi.fn(() => Promise.resolve()),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      })
    })() as any,
    withdrawDriver: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        start: vi.fn(),
        stop: vi.fn(),
        triggerTick: vi.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      })
    })() as any,
    recoveryDriver: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        start: vi.fn(),
        stop: vi.fn(),
        triggerTick: vi.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
      })
    })() as any,
  }
}

// Helper to create a mock IPC event that passes origin verification
const createMockEvent = () => {
  // Event sender must match mainWindow.webContents for origin check
  return { sender: mockMainWindow?.webContents } as any
}

let mockRegistry: ServiceRegistry

function resetHandlersTestEnv(): void {
  vi.clearAllMocks()
  mockHandlers.clear()
  mockProxyManager.removeAllListeners()
  mockStorageManager.removeAllListeners()
  _resetHandlersForTesting() // Reset guard to allow re-registration
  mockMainWindow = {
    webContents: { send: vi.fn() },
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
    setTitle: vi.fn(),
  }
  mockRegistry = createMockRegistry()
  registerIpcHandlers(mockRegistry)
}

describe('IPC Handlers', () => {
  beforeEach(resetHandlersTestEnv)

  describe('Proxy Handlers', () => {
    it('PROXY_CONNECT starts proxy and returns success', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!
      expect(handler).toBeDefined()

      const result = await handler!(createMockEvent())

      expect(result.success).toBe(true)
      expect(mockRegistry.proxyManager.start).toHaveBeenCalled()
    })

    it('PROXY_CONNECT handles errors gracefully', async () => {
      vi.mocked(mockRegistry.proxyManager.start).mockRejectedValueOnce(new Error('Proxy failed'))

      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!
      const result = await handler!(createMockEvent())

      expect(result.success).toBe(false)
      expect(result.error).toBe('Proxy failed')
    })

    it('PROXY_DISCONNECT stops both storage and proxy', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_DISCONNECT)!
      const result = await handler!(createMockEvent())

      expect(mockRegistry.storageManager.stop).toHaveBeenCalled()
      expect(mockRegistry.proxyManager.stop).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('PROXY_STATUS returns current status', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)!
      const result = await handler!(createMockEvent())

      expect(result.status).toBe('connected')
      expect(result.port).toBe(8080)
    })
  })

  describe('Tab Handlers', () => {
    it('TAB_CREATE creates a new tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_CREATE)!
      const result = await handler!(createMockEvent(), 'new-tab-id')

      expect(createTab).toHaveBeenCalledWith('new-tab-id')
      expect(result.success).toBe(true)
    })

    it('TAB_CLOSE closes a tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_CLOSE)!
      const result = await handler!(createMockEvent(), 'tab-to-close')

      expect(closeTab).toHaveBeenCalledWith('tab-to-close')
      expect(result.success).toBe(true)
    })

    it('TAB_SWITCH switches to a tab', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.TAB_SWITCH)!
      const result = await handler!(createMockEvent(), 'tab-to-activate')

      expect(switchTab).toHaveBeenCalledWith('tab-to-activate')
      expect(result.success).toBe(true)
    })
  })

  describe('Storage Handlers', () => {
    it('STORAGE_ADD_BAG forwards a valid bagId to addBag', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)!
      expect(handler).toBeDefined() // Skip if not registered

      // Valid 64-char hex
      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      await handler(createMockEvent(), validBagId, 'Test Bag')

      expect(addBag).toHaveBeenCalledWith(validBagId, 'Test Bag')
    })

    it('STORAGE_ADD_BAG rejects invalid bagId', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)!
      expect(handler).toBeDefined()

      const invalidBagId = 'invalid-bag-id'
      const result = await handler(createMockEvent(), invalidBagId, 'Test')

      expect(result.success).toBe(false)
      expect(addBag).not.toHaveBeenCalled()
    })

    it('STORAGE_REMOVE_BAG removes bag by id', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_REMOVE_BAG)!
      expect(handler).toBeDefined()

      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      await handler(createMockEvent(), validBagId)

      expect(removeBag).toHaveBeenCalledWith(validBagId)
    })
  })

  describe('Settings Handlers', () => {
    it('SETTINGS_SET updates a setting category', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_SET)!
      expect(handler).toBeDefined()

      await handler(createMockEvent(), 'network', { proxyPort: 9000 })

      expect(setSetting).toHaveBeenCalledWith('network', { proxyPort: 9000 })
    })

    it('SETTINGS_RESET restores defaults', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_RESET)!
      expect(handler).toBeDefined()

      await handler(createMockEvent())

      expect(resetSettings).toHaveBeenCalled()
    })
  })

  describe('Event Forwarding', () => {
    it('forwards proxy status events to renderer', () => {
      // Emit event on proxy manager
      ;(mockRegistry.proxyManager as EventEmitter).emit('status', 'connected')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'proxy:status',
        expect.objectContaining({ status: 'connected' })
      )
    })

    it('forwards storage bags-updated events to renderer', () => {
      const bags = [{ id: 'bag1', name: 'Test' }]
      ;(mockRegistry.storageManager as EventEmitter).emit('bags-updated', bags)

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('storage:bags-updated', bags)
    })

    it('forwards storage started event to renderer', () => {
      ;(mockRegistry.storageManager as EventEmitter).emit('started')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('storage:status', { running: true })
    })

    it('forwards storage stopped event to renderer', () => {
      ;(mockRegistry.storageManager as EventEmitter).emit('stopped')

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith('storage:status', { running: false })
    })
  })
})

describe('Security - Input Validation', () => {
  beforeEach(resetHandlersTestEnv)

  it('navigation handler rejects javascript: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'javascript:alert(1)')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects data: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'data:text/html,<script>alert(1)</script>')

    expect(result.success).toBe(false)
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects file: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'file:///etc/passwd')

    expect(result.success).toBe(false)
    expect(navigateInTab).not.toHaveBeenCalled()
  })
})

// ─── Cocoon AI Handlers ──────────────────────────────────────────────────────

/**
 * Wallet data fixture reused across Cocoon handler tests.
 * nodeSecretBase64 maps to nodeWalletKeyBase64 in CocoonConfig (the field rename
 * happens inside the COCOON_START handler before calling cocoonManager.start()).
 */
const MOCK_COCOON_WALLET = {
  ownerMnemonic: ['word1', 'word2'],
  nodeSecretBase64: 'c2VjcmV0YmFzZTY0',
  nodePublicKeyHex: 'aabbccdd',
  ownerAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  nodeAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  createdAt: 1_700_000_000_000,
}

const COCOON_ROOT_MAINNET = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

describe('Cocoon AI Handlers', () => {
  beforeEach(resetHandlersTestEnv)

  // ── COCOON_START ────────────────────────────────────────────────────────────

  describe('COCOON_START', () => {
    it('reads wallet from disk and calls cocoonManager.start with correct params', async () => {
      vi.mocked(loadCocoonWallet).mockResolvedValueOnce(MOCK_COCOON_WALLET)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(true)
      expect(result.httpPort).toBe(10000)
      expect(mockRegistry.cocoonManager.start).toHaveBeenCalledWith({
        ownerAddress: MOCK_COCOON_WALLET.ownerAddress,
        nodeWalletKeyBase64: MOCK_COCOON_WALLET.nodeSecretBase64,
        rootContractAddress: COCOON_ROOT_MAINNET,
      })
    })

    it('does not expose any secret values in the success envelope', async () => {
      vi.mocked(loadCocoonWallet).mockResolvedValueOnce(MOCK_COCOON_WALLET)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result).not.toHaveProperty('ownerMnemonic')
      expect(result).not.toHaveProperty('nodeSecretBase64')
      expect(result).not.toHaveProperty('nodeWalletKeyBase64')
    })

    it('returns error when wallet is not initialized', async () => {
      // loadCocoonWallet returns null by default (factory mock)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cocoon wallet not initialized')
      expect(mockRegistry.cocoonManager.start).not.toHaveBeenCalled()
    })

    it('is idempotent when manager is already in ready state', async () => {
      // Manager already running: don't re-spawn, just return current port.
      vi.mocked(mockRegistry.cocoonManager.getState).mockReturnValueOnce({
        kind: 'ready',
        httpPort: 10000,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(true)
      expect(result.httpPort).toBe(10000)
      expect(mockRegistry.cocoonManager.start).not.toHaveBeenCalled()
      // loadCocoonWallet is also skipped — no reason to read secrets when
      // we're not starting anything.
      expect(loadCocoonWallet).not.toHaveBeenCalled()
    })

    it('returns error without calling start() when manager is already starting', async () => {
      vi.mocked(mockRegistry.cocoonManager.getState).mockReturnValueOnce({
        kind: 'starting',
        phase: 'client-runner',
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Already starting')
      expect(mockRegistry.cocoonManager.start).not.toHaveBeenCalled()
      expect(loadCocoonWallet).not.toHaveBeenCalled()
    })

    it('calls stop() to reset then calls start() when manager is in crashed state', async () => {
      vi.mocked(mockRegistry.cocoonManager.getState).mockReturnValueOnce({
        kind: 'crashed',
        error: 'runner exited (code=1)',
      })
      vi.mocked(loadCocoonWallet).mockResolvedValueOnce(MOCK_COCOON_WALLET)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_START)!

      const result = await handler(createMockEvent())

      expect(mockRegistry.cocoonManager.stop).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
      expect(mockRegistry.cocoonManager.start).toHaveBeenCalledTimes(1)
    })
  })

  // ── COCOON_WALLET_EXISTS ────────────────────────────────────────────────────

  describe('COCOON_WALLET_EXISTS', () => {
    it('returns true when wallet exists on disk', async () => {
      vi.mocked(hasCocoonWallet).mockResolvedValueOnce(true)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_EXISTS)!

      const result = await handler(createMockEvent())

      expect(result).toBe(true)
    })

    it('returns false when no wallet exists', async () => {
      // hasCocoonWallet default mock returns false
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_EXISTS)!

      const result = await handler(createMockEvent())

      expect(result).toBe(false)
    })
  })

  // ── COCOON_WALLET_CREATE ────────────────────────────────────────────────────

  describe('COCOON_WALLET_CREATE', () => {
    it('returns ownerAddress, nodeAddress, and mnemonic for one-time display', async () => {
      vi.mocked(generateCocoonWallet).mockResolvedValueOnce({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: ['word1', 'word2', 'word3'],
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_CREATE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: ['word1', 'word2', 'word3'],
      })
      expect(generateCocoonWallet).toHaveBeenCalledTimes(1)
    })

    it('does not include raw secrets in the result envelope', async () => {
      vi.mocked(generateCocoonWallet).mockResolvedValueOnce({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: [],
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_CREATE)!

      const result = await handler(createMockEvent())

      expect(result).not.toHaveProperty('nodeSecretBase64')
      expect(result).not.toHaveProperty('nodePublicKeyHex')
    })
  })

  // ── COCOON_WALLET_INFO ──────────────────────────────────────────────────────

  describe('COCOON_WALLET_INFO', () => {
    it('returns the public-safe wallet info when a wallet exists', async () => {
      const info = {
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        nodePublicKeyHex: 'aabb',
        createdAt: 1_700_000_000_000,
        setupCompletedAt: null,
      }
      vi.mocked(getCocoonWalletInfo).mockResolvedValueOnce(info)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_INFO)!

      const result = await handler(createMockEvent())

      expect(result).toEqual(info)
      // Secrets must not leak
      expect(result).not.toHaveProperty('ownerMnemonic')
      expect(result).not.toHaveProperty('nodeSecretBase64')
    })

    it('returns null when no wallet exists', async () => {
      // getCocoonWalletInfo default mock returns null
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_INFO)!

      const result = await handler(createMockEvent())

      expect(result).toBeNull()
    })
  })

  // ── COCOON_WALLET_EXPORT_MNEMONIC ───────────────────────────────────────────

  describe('COCOON_WALLET_EXPORT_MNEMONIC', () => {
    it('returns the 24-word mnemonic list', async () => {
      const words = Array.from({ length: 24 }, (_, i) => `word${i + 1}`)
      vi.mocked(exportCocoonMnemonic).mockResolvedValueOnce(words)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_EXPORT_MNEMONIC)!

      const result = await handler(createMockEvent())

      expect(result).toEqual(words)
      expect(result).toHaveLength(24)
    })
  })

  // ── COCOON_WALLET_DELETE ────────────────────────────────────────────────────

  describe('COCOON_WALLET_DELETE', () => {
    it('delegates to deleteCocoonWallet', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_DELETE)!

      await handler(createMockEvent())

      expect(deleteCocoonWallet).toHaveBeenCalledTimes(1)
    })
  })

  // ── COCOON_WALLET_MARK_SETUP_COMPLETE ───────────────────────────────────────

  describe('COCOON_WALLET_MARK_SETUP_COMPLETE', () => {
    it('delegates to markSetupComplete', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE)!

      await handler(createMockEvent())

      expect(markSetupComplete).toHaveBeenCalledTimes(1)
    })

    it('surfaces underlying errors as IPC envelope', async () => {
      vi.mocked(markSetupComplete).mockRejectedValueOnce(new Error('storage unavailable'))
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(false)
      expect(result.error).toContain('storage unavailable')
    })
  })

  // ── COCOON_SETUP_OWNER_BALANCE ──────────────────────────────────────────────

  describe('COCOON_SETUP_OWNER_BALANCE', () => {
    it('returns the balance as a decimal nano-TON string', async () => {
      const mockBridge = { getBalance: vi.fn() }
      vi.mocked(mockRegistry.walletManager.getBridgeClient).mockReturnValueOnce(mockBridge as any)
      vi.mocked(getOwnerBalance).mockResolvedValueOnce(1_000_000_000n)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toBe('1000000000')
      expect(getOwnerBalance).toHaveBeenCalledWith(mockBridge)
    })

    it('returns error when bridge is not connected', async () => {
      // getBridgeClient returns null by default
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Bridge not connected')
    })
  })

  // ── COCOON_SETUP_COCOON_BALANCE ─────────────────────────────────────────────

  describe('COCOON_SETUP_COCOON_BALANCE', () => {
    it('returns the cocoon node wallet balance as a decimal nano-TON string', async () => {
      const mockBridge = { getBalance: vi.fn() }
      vi.mocked(mockRegistry.walletManager.getBridgeClient).mockReturnValueOnce(mockBridge as any)
      vi.mocked(getCocoonWalletBalance).mockResolvedValueOnce(19_500_000_000n)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toBe('19500000000')
      expect(getCocoonWalletBalance).toHaveBeenCalledWith(mockBridge)
    })

    it('returns error when bridge is not connected', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Bridge not connected')
    })
  })

  // ── COCOON_SETUP_FUND_COCOON ────────────────────────────────────────────────

  describe('COCOON_SETUP_FUND_COCOON', () => {
    it("'max' branch: passes 'max' to fundCocoonFromOwner and stringifies sentAmount", async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.walletManager.getBridgeClient).mockReturnValueOnce(mockBridge as any)
      vi.mocked(fundCocoonFromOwner).mockResolvedValueOnce({
        bocHash: 'abc123',
        seqno: 5,
        sentAmount: 1_500_000_000n,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'max' })

      expect(result).toEqual({ bocHash: 'abc123', seqno: 5, sentAmount: '1500000000' })
      expect(fundCocoonFromOwner).toHaveBeenCalledWith(mockBridge, 'max')
    })

    it('explicit amount: converts decimal string to BigInt before delegating', async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.walletManager.getBridgeClient).mockReturnValueOnce(mockBridge as any)
      vi.mocked(fundCocoonFromOwner).mockResolvedValueOnce({
        bocHash: 'def456',
        seqno: 3,
        sentAmount: 15_000_000_000n,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: '15000000000' })

      expect(result).toEqual({ bocHash: 'def456', seqno: 3, sentAmount: '15000000000' })
      expect(fundCocoonFromOwner).toHaveBeenCalledWith(mockBridge, 15_000_000_000n)
    })

    it('returns error for a non-numeric amount string', async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.walletManager.getBridgeClient).mockReturnValueOnce(mockBridge as any)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'not-a-number' })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('returns error when bridge is not connected', async () => {
      // getBridgeClient returns null by default
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'max' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Bridge not connected')
    })
  })
})
