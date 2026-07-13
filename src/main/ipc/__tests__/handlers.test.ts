/**
 * IPC Handlers Tests
 * Tests for critical IPC handler security and functionality
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const tabsMocks = vi.hoisted(() => ({
  createTab: vi.fn(() => Promise.resolve(true)),
  closeTab: vi.fn(() => true),
  switchTab: vi.fn(() => true),
  getActiveView: vi.fn(),
  hideAllViews: vi.fn(),
  showActiveView: vi.fn(),
  navigateInTab: vi.fn(() => Promise.resolve(true)),
  loadBagFile: vi.fn(() => Promise.resolve()),
  getActiveTabId: vi.fn(() => 'tab-1'),
}))
const loggingMocks = vi.hoisted(() => ({
  flushNativeLogs: vi.fn(() => Promise.resolve()),
  clipboardWriteText: vi.fn(),
}))
const { createTab, closeTab, switchTab, getActiveView, hideAllViews, showActiveView, navigateInTab, getActiveTabId } =
  tabsMocks

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
    removeHandler: vi.fn((channel: string) => mockHandlers.delete(channel)),
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
    getVersion: vi.fn(() => '2.3.1'),
  },
  clipboard: { writeText: loggingMocks.clipboardWriteText },
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

vi.mock('../../logging/native-log-router', () => ({ flushNativeLogs: loggingMocks.flushNativeLogs }))

// Mock proxy manager (class export only, singleton removed)
vi.mock('../../proxy/manager', () => ({
  ProxyManager: vi.fn(),
}))

// Mock storage manager (class export only, singleton removed)
vi.mock('../../storage/daemon', () => ({
  StorageManager: vi.fn(),
}))

// Mock storage bags

// Mock settings
vi.mock('../../settings', () => ({
  SettingsRuntimeApplyError: class SettingsRuntimeApplyError extends Error {},
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
  TabManager: vi.fn(),
  fileBrowserCache: new Map(),
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

vi.mock('../error-handler', () => ({
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
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { getSetting, SettingsRuntimeApplyError } from '../../settings'
import type { ServiceRegistry } from '../../services'
import { DisposableStore } from '../../utils/disposable'
import { overlayIdB64ForRoom } from '../../chat/room'
import { sealBroadcast } from '../../chat/broadcast'
import { marshalEnvelope, signEnvelope } from '../../chat/envelope'
import { generateCocoonWallet, loadCocoonWallet, markSetupComplete } from '../../cocoon/wallet'
import { getOwnerBalance, getCocoonWalletBalance, fundCocoonFromOwner } from '../../cocoon/setup'
import { ChatSessionController } from '../../chat/session-controller'
import { AppSettingsSchema } from '../../../shared/types'

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
    addBag: vi.fn(() => Promise.resolve({ id: 'test-bag', status: 'downloading' })),
    removeBag: vi.fn(() => Promise.resolve(true)),
    listBags: vi.fn(() => Promise.resolve([])),
    pauseBag: vi.fn(() => Promise.resolve(true)),
    getBagDetails: vi.fn(() => Promise.resolve({ id: 'test-bag', files: [] })),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  })
})()

function createMockRegistry(): ServiceRegistry {
  return {
    ipcRegistrations: new DisposableStore(),
    lifecycleRegistrations: new DisposableStore(),
    secureStorage: { isAvailable: () => false, encrypt: vi.fn(), decrypt: vi.fn(), getBackendName: () => 'mock' },
    proxyManager: mockProxyManager as any,
    storageManager: mockStorageManager as any,
    walletManager: (() => {
      const emitter = new EventEmitter()
      return Object.assign(emitter, {
        getState: vi.fn(() => ({ isCreated: false })),
        setAutoLockMinutes: vi.fn(),
        getTonBridge: vi.fn(() => null),
        getMessengerBridge: vi.fn(() => null),
        fetchOnChainHistory: vi.fn(() => []),
      })
    })() as any,
    walletHistoryManager: {
      add: vi.fn(),
      getAll: vi.fn(() => []),
      reconcile: vi.fn((tx) => tx),
      clear: vi.fn(),
    } as any,
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
    tonConnectService: {
      init: vi.fn(),
      handleRequest: vi.fn(),
      getSessions: vi.fn(() => []),
      disconnectSession: vi.fn(),
      clearSessions: vi.fn(),
    } as any,
    tonConnectSessionStore: { init: vi.fn(), list: vi.fn(() => []) } as any,
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
    tabManager: {
      sessions: {
        getAllSessions: vi.fn(() => []),
        onPrivacySettingsChanged: vi.fn(),
      },
      storage: {
        storageManager: mockStorageManager,
        storageBagCache: new Map(),
        storageBrowserLoading: new Set(),
        fileBrowserCache: new Map(),
      },
      createTab,
      closeTab,
      switchTab,
      navigateInTab,
      getActiveView,
      getActiveTabId,
      hideAllViews,
      showActiveView,
      loadBagFile: tabsMocks.loadBagFile,
      updateSidebarWidth: vi.fn(),
      updateWalletSidebarWidth: vi.fn(),
      onAppearanceSettingsChanged: vi.fn(),
      updateProxyPort: vi.fn(() => Promise.resolve()),
      initialize: vi.fn(),
      dispose: vi.fn(),
    } as any,
    chatSessionController: new ChatSessionController() as any,
    cocoonPersistence: {
      stakeCache: { getPendingWithdraw: vi.fn(() => Promise.resolve(null)) },
      consumedArchive: { list: vi.fn(() => Promise.resolve([])), getByArchivedAt: vi.fn(() => Promise.resolve(null)) },
      recoveryQueue: { list: vi.fn(() => Promise.resolve([])), remove: vi.fn(() => Promise.resolve()) },
    } as any,
    cocoonActivation: {
      cocoonManager: null as any,
      getBridge: vi.fn(() => null),
      getNativeAddress: vi.fn(() => null),
      getNativeBalance: vi.fn(() => Promise.resolve('0')),
      sendNative: vi.fn(() => Promise.resolve()),
      persistence: null as any,
    },
    settingsCoordinator: {
      apply: vi.fn(() => Promise.resolve(AppSettingsSchema.parse({}))),
      reset: vi.fn(() => Promise.resolve(AppSettingsSchema.parse({}))),
    } as any,
  }
}

// Helper to create a mock IPC event that passes origin verification
const createMockEvent = () => {
  // Event sender must match mainWindow.webContents for origin check
  return { sender: mockMainWindow?.webContents } as any
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

  it('owns every handler and push listener in a disposable registration scope', () => {
    const handlerCount = mockHandlers.size
    expect(handlerCount).toBeGreaterThan(0)
    expect(mockProxyManager.listenerCount('status')).toBe(1)
    expect(mockStorageManager.listenerCount('bags-updated')).toBe(1)

    mockRegistry.ipcRegistrations.dispose()

    expect(mockHandlers.size).toBe(0)
    expect(mockProxyManager.listenerCount('status')).toBe(0)
    expect(mockStorageManager.listenerCount('bags-updated')).toBe(0)

    const replacement = createMockRegistry()
    registerIpcHandlers(replacement)
    expect(mockHandlers.size).toBe(handlerCount)
    expect(mockProxyManager.listenerCount('status')).toBe(1)
    expect(mockStorageManager.listenerCount('bags-updated')).toBe(1)
    replacement.ipcRegistrations.dispose()
  })

  describe('Proxy Handlers', () => {
    it('applies the effective proxy port when the runtime connects', async () => {
      vi.mocked(mockRegistry.proxyManager.getStatus).mockReturnValueOnce({
        status: 'connected',
        connected: true,
        syncing: false,
        port: 9090,
      } as never)

      mockProxyManager.emit('status', 'connected')
      await Promise.resolve()

      expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(9090)
    })

    it('does not publish a stale connected status after the runtime stops', async () => {
      const update = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort).mockReturnValueOnce(update.promise)
      vi.mocked(mockRegistry.proxyManager.getStatus)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'stopped', connected: false, port: 9090 } as never)

      mockProxyManager.emit('status', 'connected')
      mockProxyManager.emit('status', 'stopped')
      update.resolve()
      await update.promise
      await Promise.resolve()

      const statusEvents = vi
        .mocked(mockMainWindow.webContents.send)
        .mock.calls.filter((call: unknown[]) => call[0] === IPC_CHANNELS.PROXY_STATUS)
      expect(statusEvents).toEqual([[IPC_CHANNELS.PROXY_STATUS, expect.objectContaining({ status: 'stopped' })]])
    })

    it('PROXY_CONNECT starts proxy and returns success', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!
      expect(handler).toBeDefined()

      const result = await handler!(createMockEvent())

      expect(result.success).toBe(true)
      expect(mockRegistry.proxyManager.start).toHaveBeenCalled()
    })

    it('PROXY_CONNECT waits for the effective proxy port', async () => {
      const update = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort).mockReturnValueOnce(update.promise)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      let settled = false
      void result.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      update.resolve()
      await expect(result).resolves.toMatchObject({ success: true })
    })

    it('PROXY_CONNECT follows proxy port changes before returning', async () => {
      const firstUpdate = deferred<void>()
      const secondUpdate = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort)
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise)
      vi.mocked(mockRegistry.proxyManager.getStatus)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 8080 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      firstUpdate.resolve()
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(9090))
      secondUpdate.resolve()

      await expect(result).resolves.toMatchObject({ success: true, status: 'connected', port: 9090 })
    })

    it('PROXY_CONNECT handles errors gracefully', async () => {
      vi.mocked(mockRegistry.proxyManager.start).mockRejectedValueOnce(new Error('Proxy failed'))

      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_CONNECT)!
      const result = await handler!(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'PROXY_START_FAILED', message: 'Operation failed', retryable: false },
      })
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

    it('PROXY_STATUS waits for the effective proxy port', async () => {
      const update = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort).mockReturnValueOnce(update.promise)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      update.resolve()

      await expect(result).resolves.toMatchObject({ status: 'connected', port: 8080 })
    })

    it('PROXY_STATUS follows proxy port changes before returning', async () => {
      const firstUpdate = deferred<void>()
      const secondUpdate = deferred<void>()
      vi.mocked(mockRegistry.tabManager.updateProxyPort)
        .mockReturnValueOnce(firstUpdate.promise)
        .mockReturnValueOnce(secondUpdate.promise)
      vi.mocked(mockRegistry.proxyManager.getStatus)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 8080 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
        .mockReturnValueOnce({ status: 'connected', connected: true, port: 9090 } as never)
      const handler = mockHandlers.get(IPC_CHANNELS.PROXY_STATUS)!

      const result = handler(createMockEvent())
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(8080))
      firstUpdate.resolve()
      await vi.waitFor(() => expect(mockRegistry.tabManager.updateProxyPort).toHaveBeenCalledWith(9090))
      secondUpdate.resolve()

      await expect(result).resolves.toMatchObject({ status: 'connected', port: 9090 })
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

      expect(mockStorageManager.addBag).toHaveBeenCalledWith(validBagId)
    })

    it('STORAGE_ADD_BAG rejects invalid bagId', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_ADD_BAG)!
      expect(handler).toBeDefined()

      const invalidBagId = 'invalid-bag-id'
      const result = await handler(createMockEvent(), invalidBagId, 'Test')

      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid request payload', retryable: false },
      })
      expect(mockStorageManager.addBag).not.toHaveBeenCalled()
    })

    it('STORAGE_REMOVE_BAG removes bag by id', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.STORAGE_REMOVE_BAG)!
      expect(handler).toBeDefined()

      const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      await handler(createMockEvent(), validBagId)

      expect(mockStorageManager.removeBag).toHaveBeenCalledWith(validBagId)
    })
  })

  describe('Settings Handlers', () => {
    it('SETTINGS_SET updates a setting category', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_SET)!
      expect(handler).toBeDefined()

      await handler(createMockEvent(), 'network', { proxyPort: 9000 })

      expect(mockRegistry.settingsCoordinator.apply).toHaveBeenCalledWith({ network: { proxyPort: 9000 } })
    })

    it('SETTINGS_APPLY submits one multi-category transaction', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_APPLY)!
      const patch = { network: { proxyPort: 9000 }, privacy: { clearOnExit: false } }

      const result = await handler(createMockEvent(), patch)

      expect(mockRegistry.settingsCoordinator.apply).toHaveBeenCalledWith(patch)
      expect(result).toEqual(AppSettingsSchema.parse({}))
    })

    it('SETTINGS_SET reports runtime apply failures', async () => {
      vi.mocked(mockRegistry.settingsCoordinator.apply).mockRejectedValueOnce(
        new SettingsRuntimeApplyError(new Error('port unavailable'))
      )
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_SET)!

      const result = await handler(createMockEvent(), 'network', { proxyPort: 9000 })

      expect(result).toEqual({
        ok: false,
        error: { code: 'RUNTIME_APPLY_FAILED', message: 'Unable to apply settings', retryable: false },
      })
    })

    it('SETTINGS_RESET restores defaults', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_RESET)!
      expect(handler).toBeDefined()

      await handler(createMockEvent())

      expect(mockRegistry.settingsCoordinator.reset).toHaveBeenCalled()
    })

    it('flushes native logs before copying the diagnostic report', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.SETTINGS_DIAGNOSTICS_COPY)!
      await handler(createMockEvent())

      expect(loggingMocks.flushNativeLogs).toHaveBeenCalledOnce()
      expect(loggingMocks.clipboardWriteText).toHaveBeenCalledOnce()
      expect(loggingMocks.flushNativeLogs.mock.invocationCallOrder[0]).toBeLessThan(
        loggingMocks.clipboardWriteText.mock.invocationCallOrder[0]
      )
    })
  })

  describe('Chat Handlers', () => {
    it('emits replayed history messages even when the signed broadcast date is stale', async () => {
      const room = 'tonnet:groupchat'
      const overlayId = overlayIdB64ForRoom(room)
      const bootstrap = Buffer.alloc(32, 9).toString('base64')
      let overlayMessage: ((data: { overlay_id: string; message: string }) => void) | null = null
      const bridge = {
        dhtFindValue: vi.fn(),
        overlayConnectAndJoin: vi.fn(() => Promise.resolve('peer-id')),
        onOverlayMessage: vi.fn((cb: (data: { overlay_id: string; message: string }) => void) => {
          overlayMessage = cb
          return vi.fn()
        }),
        overlaySendRaw: vi.fn(() => Promise.resolve()),
        overlayLeaveAndDisconnect: vi.fn(() => Promise.resolve()),
        adnlPing: vi.fn(() => Promise.resolve()),
      }
      vi.mocked(getSetting).mockImplementation(((category: string) => {
        if (category === 'messenger') return { networkEnabled: true, attachWalletIdentity: false }
        return {}
      }) as typeof getSetting)
      vi.mocked(mockRegistry.walletManager.getMessengerBridge).mockReturnValue(bridge as any)

      const connect = mockHandlers.get(IPC_CHANNELS.CHAT_CONNECT)!
      const disconnect = mockHandlers.get(IPC_CHANNELS.CHAT_DISCONNECT)!
      await connect(createMockEvent(), room, bootstrap)

      const peerSeed = Buffer.alloc(32, 19)
      const env = signEnvelope(
        { type: 'msg', nick: 'alice', text: 'from history', ts: Date.now() - 120_000, room },
        peerSeed
      )
      const wire = sealBroadcast(peerSeed, marshalEnvelope(env), Math.floor(Date.now() / 1000) - 120)
      overlayMessage!({ overlay_id: overlayId, message: wire.toString('base64') })
      await new Promise((resolve) => setImmediate(resolve))

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.CHAT_MESSAGE,
        expect.objectContaining({ room, text: 'from history', deviceKey: env.key })
      )
      await disconnect(createMockEvent())
    })
  })

  describe('Event Forwarding', () => {
    it('forwards proxy status events to renderer', async () => {
      // Emit event on proxy manager
      ;(mockRegistry.proxyManager as EventEmitter).emit('status', 'connected')

      await vi.waitFor(() =>
        expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
          'proxy:status',
          expect.objectContaining({ status: 'connected' })
        )
      )
    })

    it('forwards storage bags-updated events to renderer', () => {
      const bags = [
        {
          id: 'bag1',
          name: 'Test',
          size: 100,
          downloaded: 50,
          uploadSpeed: 0,
          downloadSpeed: 10,
          peers: 1,
          filesCount: 2,
          status: 'downloading',
        },
      ]
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

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_URL', message: 'Invalid navigation URL', retryable: false },
    })
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects data: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'data:text/html,<script>alert(1)</script>')

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_URL', retryable: false } })
    expect(navigateInTab).not.toHaveBeenCalled()
  })

  it('navigation handler rejects file: URLs', async () => {
    const handler = mockHandlers.get(IPC_CHANNELS.NAVIGATE)!
    expect(handler).toBeDefined()

    const result = await handler(createMockEvent(), 'file:///etc/passwd')

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_URL', retryable: false } })
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
const MOCK_COCOON_MNEMONIC = Array.from({ length: 24 }, (_, index) => `word${index + 1}`)

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

      expect(result).toEqual({
        ok: false,
        error: { code: 'START_FAILED', message: 'Operation failed', retryable: false },
      })
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

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'ALREADY_STARTING', message: 'Cocoon is already starting', retryable: true },
      })
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

  // ── COCOON_WALLET_CREATE ────────────────────────────────────────────────────

  describe('COCOON_WALLET_CREATE', () => {
    it('returns ownerAddress, nodeAddress, and mnemonic for one-time display', async () => {
      vi.mocked(generateCocoonWallet).mockResolvedValueOnce({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: MOCK_COCOON_MNEMONIC,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_CREATE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: MOCK_COCOON_MNEMONIC,
      })
      expect(generateCocoonWallet).toHaveBeenCalledTimes(1)
    })

    it('does not include raw secrets in the result envelope', async () => {
      vi.mocked(generateCocoonWallet).mockResolvedValueOnce({
        ownerAddress: 'EQOwner',
        nodeAddress: 'EQNode',
        mnemonic: MOCK_COCOON_MNEMONIC,
      })
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_CREATE)!

      const result = await handler(createMockEvent())

      expect(result).not.toHaveProperty('nodeSecretBase64')
      expect(result).not.toHaveProperty('nodePublicKeyHex')
    })
  })

  // ── COCOON_WALLET_MARK_SETUP_COMPLETE ───────────────────────────────────────

  describe('COCOON_WALLET_MARK_SETUP_COMPLETE', () => {
    it('surfaces underlying errors as IPC envelope', async () => {
      vi.mocked(markSetupComplete).mockRejectedValueOnce(new Error('storage unavailable'))
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'WALLET_WRITE_FAILED', message: 'Operation failed', retryable: false },
      })
    })
  })

  // ── COCOON_SETUP_OWNER_BALANCE ──────────────────────────────────────────────

  describe('COCOON_SETUP_OWNER_BALANCE', () => {
    it('returns the balance as a decimal nano-TON string', async () => {
      const mockBridge = { getBalance: vi.fn() }
      vi.mocked(mockRegistry.walletManager.getTonBridge).mockReturnValueOnce(mockBridge as any)
      vi.mocked(getOwnerBalance).mockResolvedValueOnce(1_000_000_000n)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toBe('1000000000')
      expect(getOwnerBalance).toHaveBeenCalledWith(mockBridge)
    })

    it('returns error when bridge is not connected', async () => {
      // getTonBridge returns null by default
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'BALANCE_READ_FAILED', message: 'Operation failed', retryable: false },
      })
    })
  })

  // ── COCOON_SETUP_COCOON_BALANCE ─────────────────────────────────────────────

  describe('COCOON_SETUP_COCOON_BALANCE', () => {
    it('returns the cocoon node wallet balance as a decimal nano-TON string', async () => {
      const mockBridge = { getBalance: vi.fn() }
      vi.mocked(mockRegistry.walletManager.getTonBridge).mockReturnValueOnce(mockBridge as any)
      vi.mocked(getCocoonWalletBalance).mockResolvedValueOnce(19_500_000_000n)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toBe('19500000000')
      expect(getCocoonWalletBalance).toHaveBeenCalledWith(mockBridge)
    })

    it('returns error when bridge is not connected', async () => {
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE)!

      const result = await handler(createMockEvent())

      expect(result).toEqual({
        ok: false,
        error: { code: 'BALANCE_READ_FAILED', message: 'Operation failed', retryable: false },
      })
    })
  })

  // ── COCOON_SETUP_FUND_COCOON ────────────────────────────────────────────────

  describe('COCOON_SETUP_FUND_COCOON', () => {
    it("'max' branch: passes 'max' to fundCocoonFromOwner and stringifies sentAmount", async () => {
      const mockBridge = {}
      vi.mocked(mockRegistry.walletManager.getTonBridge).mockReturnValueOnce(mockBridge as any)
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
      vi.mocked(mockRegistry.walletManager.getTonBridge).mockReturnValueOnce(mockBridge as any)
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
      vi.mocked(mockRegistry.walletManager.getTonBridge).mockReturnValueOnce(mockBridge as any)
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'not-a-number' })

      expect(result).toEqual({
        ok: false,
        error: { code: 'INVALID_INPUT', message: 'Invalid request payload', retryable: false },
      })
    })

    it('returns error when bridge is not connected', async () => {
      // getTonBridge returns null by default
      const handler = mockHandlers.get(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON)!

      const result = await handler(createMockEvent(), { amount: 'max' })

      expect(result).toEqual({
        ok: false,
        error: { code: 'FUND_FAILED', message: 'Operation failed', retryable: false },
      })
    })
  })
})
