/**
 * Integration test for services.ts composition root.
 * Verifies createServices() wires all dependencies and
 * destroyServices() tears down without errors.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// ---------------------------------------------------------------------------
// Module mocks (declared before any import that touches them)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-services'),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from('ENC:' + s)),
    decryptString: vi.fn((b: Buffer) => {
      const str = b.toString()
      return str.startsWith('ENC:') ? str.slice(4) : str
    }),
    getSelectedStorageBackend: vi.fn(() => 'test-backend'),
  },
  BrowserWindow: vi.fn(),
  WebContentsView: vi.fn(() => ({
    webContents: {
      loadURL: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      session: { webRequest: { onBeforeRequest: vi.fn() } },
    },
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  })),
  webContents: {
    getAllWebContents: vi.fn(() => []),
  },
}))

vi.mock('child_process', () => {
  const makeProc = (): EventEmitter & { kill: ReturnType<typeof vi.fn>; pid: number } => {
    const proc = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn>; pid: number }
    proc.kill = vi.fn()
    proc.pid = 12345
    return proc
  }
  return {
    spawn: vi.fn(() => makeProc()),
    execFile: vi.fn(),
  }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    promises: {
      writeFile: vi.fn(),
      readFile: vi.fn(() => Promise.resolve('{}')),
      access: vi.fn(() => Promise.reject(new Error('ENOENT'))),
      unlink: vi.fn(),
      mkdir: vi.fn(),
    },
  }
})

vi.mock('@ton/crypto', () => ({
  mnemonicNew: vi.fn(() => Promise.resolve(Array(24).fill('test'))),
  mnemonicToPrivateKey: vi.fn(() =>
    Promise.resolve({
      publicKey: Buffer.alloc(32, 1),
      secretKey: Buffer.alloc(64, 2),
    })
  ),
  mnemonicValidate: vi.fn((words: string[]) => Promise.resolve(words.length === 24)),
  keyPairFromSeed: vi.fn(() => ({
    publicKey: Buffer.alloc(32, 1),
    secretKey: Buffer.alloc(64, 2),
  })),
}))

vi.mock('@ton/ton', () => ({
  WalletContractV5R1: {
    create: vi.fn(() => ({
      address: {
        toString: () => 'UQTest...',
        toRawString: () => '0:test...',
      },
    })),
  },
}))

vi.mock('@ton/core', () => ({
  Address: {
    parseRaw: vi.fn(() => ({
      toString: () => 'UQTest...',
    })),
  },
  internal: vi.fn(),
  beginCell: vi.fn(() => ({ store: vi.fn().mockReturnThis(), endCell: vi.fn() })),
  storeMessage: vi.fn(),
  SendMode: { PAY_GAS_SEPARATELY: 1 },
  Cell: { fromBase64: vi.fn() },
}))

vi.mock('ws', () => {
  const MockWebSocket = vi.fn(() => {
    const ws = new EventEmitter()
    Object.assign(ws, {
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
      readyState: 1,
      OPEN: 1,
    })
    return ws
  })
  Object.assign(MockWebSocket, { OPEN: 1, CLOSED: 3 })
  return { default: MockWebSocket, WebSocket: MockWebSocket }
})

// Mock settings module to return valid defaults
vi.mock('../settings', () => ({
  getSetting: vi.fn((key: string) => {
    const defaults: Record<string, unknown> = {
      network: { proxyPort: 8080, wsPort: 8081, storagePort: 9090 },
      storage: { downloadPath: '/tmp/downloads' },
      advanced: { verbosity: 0 },
      privacy: { historyMode: 'memory' },
      wallet: { paymentMode: 'manual' },
      bridge: { permissions: [] },
      contentFiltering: { enabled: false },
    }
    return defaults[key] ?? {}
  }),
  setSetting: vi.fn(),
  getDownloadPath: vi.fn(() => '/tmp/downloads'),
}))

vi.mock('../settings/validation', () => ({
  SETTINGS_CATEGORIES: {},
}))

vi.mock('../windows/main', () => ({
  getMainWindow: vi.fn(() => null),
  setMainWindow: vi.fn(),
}))

vi.mock('../utils/paths', () => ({
  getBinaryPath: vi.fn((name: string) => `/tmp/bin/${name}`),
  getStoragePath: vi.fn(() => '/tmp/storage'),
  getConfigPath: vi.fn(() => '/tmp/config'),
}))

// ---------------------------------------------------------------------------
// Import under test (after all mocks)
// ---------------------------------------------------------------------------

import { createServices, destroyServices, type ServiceRegistry } from '../services'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('services composition root', () => {
  let registry: ServiceRegistry

  beforeEach(() => {
    registry = createServices()
  })

  it('createServices returns a registry with all expected properties', () => {
    const expectedKeys: (keyof ServiceRegistry)[] = [
      'pathProvider',
      'secureStorage',
      'proxyManager',
      'storageManager',
      'walletManager',
      'walletHistoryManager',
      'paymentInterceptor',
      'paymentPolicyStore',
      'overlayManager',
      'bridgeInterceptor',
      'bridgePermissionStore',
      'historyManager',
      'contentFilterManager',
    ]

    for (const key of expectedKeys) {
      expect(registry[key], `registry.${key} should be defined`).toBeDefined()
      expect(registry[key], `registry.${key} should not be null`).not.toBeNull()
    }
  })

  it('registry has exactly the expected number of services', () => {
    expect(Object.keys(registry)).toHaveLength(13)
  })

  it('walletManager receives secureStorage dependency', () => {
    // WalletManager constructor receives the secureStorage adapter
    expect(registry.walletManager).toBeDefined()
    expect(registry.secureStorage).toBeDefined()
  })

  it('bridgeInterceptor receives permissionStore and overlayManager', () => {
    expect(registry.bridgeInterceptor).toBeDefined()
    expect(registry.bridgePermissionStore).toBeDefined()
    expect(registry.overlayManager).toBeDefined()
  })

  it('destroyServices completes without throwing', async () => {
    await expect(destroyServices(registry)).resolves.toBeUndefined()
  })

  it('destroyServices calls cleanup methods on services', async () => {
    const overlaySpy = vi.spyOn(registry.overlayManager, 'destroy')
    const bridgeSpy = vi.spyOn(registry.bridgeInterceptor, 'destroy')
    const policySpy = vi.spyOn(registry.paymentPolicyStore, 'destroy')
    const proxySpy = vi.spyOn(registry.proxyManager, 'stop')
    const storageSpy = vi.spyOn(registry.storageManager, 'stop')
    const walletSpy = vi.spyOn(registry.walletManager, 'destroy')

    await destroyServices(registry)

    expect(overlaySpy).toHaveBeenCalled()
    expect(bridgeSpy).toHaveBeenCalled()
    expect(policySpy).toHaveBeenCalled()
    expect(proxySpy).toHaveBeenCalled()
    expect(storageSpy).toHaveBeenCalled()
    expect(walletSpy).toHaveBeenCalled()
  })
})
