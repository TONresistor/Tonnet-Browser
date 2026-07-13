/**
 * ProxyManager Tests
 * Tests for proxy lifecycle and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockProcess } from '../../__tests__/mock-child-process'

// Mock settings
const mockSettings = {
  general: {
    resolveEth: true,
    ethRpc: '',
    resolveSol: true,
    solRpc: '',
  },
  network: {
    proxyPort: 8080,
    wsPort: 8081,
    connectionTimeout: 5,
    anonymousMode: false,
  },
  advanced: {
    proxyVerbosity: 2,
    syncTestDomain: 'test.ton',
  },
  messenger: {
    networkEnabled: false,
  },
}

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../settings', () => ({
  getSetting: vi.fn((category: string) => mockSettings[category as keyof typeof mockSettings]),
}))

vi.mock('../../utils/paths', () => ({
  getBinaryPath: vi.fn((name: string) => `/mock/bin/${name}`),
}))

vi.mock('../config-writer', () => ({
  writeProxyConfig: vi.fn(() => Promise.resolve()),
  applyBridgeDefaults: vi.fn(() => Promise.resolve()),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/mock-userdata'),
  },
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() =>
      JSON.stringify({
        TunnelConfig: { NodesPoolConfigPath: '', TunnelSectionsNum: 0 },
      })
    ),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    chmodSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() =>
    JSON.stringify({
      TunnelConfig: { NodesPoolConfigPath: '', TunnelSectionsNum: 0 },
    })
  ),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
}))
vi.mock('fs/promises', () => ({ mkdir: vi.fn(() => Promise.resolve()) }))

// Import after mocks
import { ProxyManager, buildProxyArgs } from '../manager'
import { spawn } from 'child_process'

describe('ProxyManager', () => {
  let manager: ProxyManager
  let mockProxyProcess: ReturnType<typeof createMockProcess>
  let mockBridgeProcess: ReturnType<typeof createMockProcess>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(spawn).mockReset()
    mockProxyProcess = createMockProcess()
    mockBridgeProcess = createMockProcess()
    // First spawn call = proxy, second = bridge
    vi.mocked(spawn)
      .mockReturnValueOnce(mockProxyProcess as any)
      .mockReturnValueOnce(mockBridgeProcess as any)
    manager = new ProxyManager()
  })

  afterEach(async () => {
    await manager.stop()
  })

  /** Emit proxy ready signal so start() resolves */
  const emitProxyReady = (proc = mockProxyProcess) => {
    setImmediate(() => {
      proc.stderr.emit('data', Buffer.from('Starting proxy server\n'))
    })
  }

  describe('Initial State', () => {
    it('starts with status "stopped"', () => {
      expect(manager.getStatus().status).toBe('stopped')
    })

    it('isRunning() returns false initially', () => {
      expect(manager.isRunning()).toBe(false)
    })

    it('isSynced() returns false initially', () => {
      expect(manager.isSynced()).toBe(false)
    })
  })

  describe('start()', () => {
    it('spawns proxy process with correct arguments (no -ws-addr)', async () => {
      emitProxyReady()

      await manager.start()

      expect(spawn).toHaveBeenCalledWith(
        '/mock/bin/tonutils-proxy',
        ['-addr', '127.0.0.1:8080', '-no-http', '-verbosity', '2'],
        expect.objectContaining({ windowsHide: true, cwd: expect.stringContaining('proxy') })
      )

      manager.stop()
    })

    it('spawns bridge process with correct arguments', async () => {
      emitProxyReady()

      await manager.start()

      expect(spawn).toHaveBeenCalledWith(
        '/mock/bin/tonutils-bridge',
        ['-addr', '127.0.0.1:8081', '-data-dir', expect.stringContaining('bridge'), '-verbosity', '2'],
        expect.objectContaining({ windowsHide: true })
      )

      manager.stop()
    })

    it('spawns both proxy and bridge (two spawn calls)', async () => {
      emitProxyReady()

      await manager.start()

      expect(spawn).toHaveBeenCalledTimes(2)

      manager.stop()
    })

    it('bridge has no tunnel flag even in anonymous mode', async () => {
      mockSettings.network.anonymousMode = true

      const proxyProc = createMockProcess()
      const bridgeProc = createMockProcess()
      vi.mocked(spawn)
        .mockReset()
        .mockReturnValueOnce(proxyProc as any)
        .mockReturnValueOnce(bridgeProc as any)

      setImmediate(() => {
        proxyProc.stderr.emit('data', Buffer.from('Starting proxy server\n'))
      })

      const newManager = new ProxyManager()
      await newManager.start()

      const bridgeCall = vi.mocked(spawn).mock.calls[1]
      const bridgeArgs = bridgeCall[1] as string[]
      expect(bridgeArgs).not.toContain('-tunnel')

      newManager.stop()
      mockSettings.network.anonymousMode = false
    })

    it('throws if proxy already running', async () => {
      emitProxyReady()

      await manager.start()

      await expect(manager.start()).rejects.toThrow('Proxy already running')

      manager.stop()
    })

    it('emits "status" event with "starting"', async () => {
      emitProxyReady()

      const statusSpy = vi.fn()
      manager.on('status', statusSpy)

      await manager.start()

      expect(statusSpy).toHaveBeenCalledWith('starting')

      await manager.stop()
    })

    it('uses default port 8080 for invalid port below 1024', async () => {
      mockSettings.network.proxyPort = 123

      const proxyProc = createMockProcess()
      const bridgeProc = createMockProcess()
      vi.mocked(spawn)
        .mockReset()
        .mockReturnValueOnce(proxyProc as any)
        .mockReturnValueOnce(bridgeProc as any)

      setImmediate(() => {
        proxyProc.stderr.emit('data', Buffer.from('Starting proxy server'))
      })

      const newManager = new ProxyManager()
      await newManager.start()

      expect(spawn).toHaveBeenCalledWith(
        '/mock/bin/tonutils-proxy',
        ['-addr', '127.0.0.1:8080', '-no-http', '-verbosity', '2'],
        expect.objectContaining({ windowsHide: true })
      )

      newManager.stop()
      mockSettings.network.proxyPort = 8080
    })
  })

  describe('stop()', () => {
    it('kills both processes', async () => {
      emitProxyReady()

      await manager.start()
      await manager.stop()

      expect(mockProxyProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(mockBridgeProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('emits "disconnected" event', async () => {
      emitProxyReady()

      const disconnectSpy = vi.fn()
      manager.on('disconnected', disconnectSpy)

      await manager.start()
      await manager.stop()

      expect(disconnectSpy).toHaveBeenCalled()
    })

    it('sets status to "stopped"', async () => {
      emitProxyReady()

      await manager.start()
      await manager.stop()

      expect(manager.getStatus().status).toBe('stopped')
    })

    it('does nothing if not running', async () => {
      await expect(manager.stop()).resolves.toBeUndefined()
      expect(mockProxyProcess.kill).not.toHaveBeenCalled()
      expect(mockBridgeProcess.kill).not.toHaveBeenCalled()
    })
  })

  describe('waitForReady() timeout', () => {
    it('throws timeout error if proxy never outputs ready signal', async () => {
      mockSettings.network.connectionTimeout = 1

      const proxyProc = createMockProcess()
      const bridgeProc = createMockProcess()
      vi.mocked(spawn)
        .mockReset()
        .mockReturnValueOnce(proxyProc as any)
        .mockReturnValueOnce(bridgeProc as any)

      const newManager = new ProxyManager()

      await expect(newManager.start()).rejects.toThrow('Process readiness timed out after 1000ms')

      mockSettings.network.connectionTimeout = 5
    }, 10000)

    it('succeeds when proxy outputs "Starting proxy server"', async () => {
      emitProxyReady()

      await expect(manager.start()).resolves.toBeUndefined()

      manager.stop()
    })
  })

  describe('Process Events', () => {
    it('emits "log" on proxy stdout data', async () => {
      emitProxyReady()

      const logSpy = vi.fn()
      manager.on('log', logSpy)

      await manager.start()
      mockProxyProcess.stdout.emit('data', Buffer.from('Test log message\n'))

      expect(logSpy).toHaveBeenCalledWith('Test log message')

      manager.stop()
    })

    it('emits "log" on proxy stderr data', async () => {
      emitProxyReady()

      const logSpy = vi.fn()
      manager.on('log', logSpy)

      await manager.start()
      mockProxyProcess.stderr.emit('data', Buffer.from('Error message\n'))

      expect(logSpy).toHaveBeenCalledWith('Error message')

      manager.stop()
    })

    it('detects a storage bag from the raw proxy line without exposing the raw line', async () => {
      emitProxyReady()
      const detected = vi.fn()
      const exposedLog = vi.fn()
      manager.on('storage-bag-detected', detected)
      manager.on('log', exposedLog)
      await manager.start()

      const bagId = 'a'.repeat(64)
      mockProxyProcess.stdout.emit('data', Buffer.from(`searching for bag id bag_id=${bagId} host=private.ton\n`))

      expect(detected).toHaveBeenCalledWith({ bagId, domain: 'private.ton' })
      expect(exposedLog).toHaveBeenCalledWith(expect.stringContaining('host=[REDACTED]'))
      expect(exposedLog).not.toHaveBeenCalledWith(expect.stringContaining('private.ton'))
    })

    it('emits "log" on bridge stdout data', async () => {
      emitProxyReady()

      const logSpy = vi.fn()
      manager.on('log', logSpy)

      await manager.start()
      mockBridgeProcess.stdout.emit('data', Buffer.from('Bridge log\n'))

      expect(logSpy).toHaveBeenCalledWith('Bridge log')

      manager.stop()
    })

    it('handles proxy process exit', async () => {
      emitProxyReady()

      const exitSpy = vi.fn()
      manager.on('exit', exitSpy)

      await manager.start()
      mockProxyProcess.emit('exit', 1)

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(manager.getStatus().status).toBe('stopped')
      expect(manager.isRunning()).toBe(false)
    })

    it('emits bridge-exit without stopping the session when the proxy is still alive', async () => {
      emitProxyReady()

      const exitSpy = vi.fn()
      const bridgeExitSpy = vi.fn()
      manager.on('exit', exitSpy)
      manager.on('bridge-exit', bridgeExitSpy)

      await manager.start()
      mockBridgeProcess.emit('exit', 1)

      // Bridge-only crash: signalled via bridge-exit, NOT the session-wide exit.
      expect(bridgeExitSpy).toHaveBeenCalledWith(1)
      expect(exitSpy).not.toHaveBeenCalled()
      // No longer fully running (bridge gone) but the proxy process survives.
      expect(manager.isRunning()).toBe(false)
    })

    it('emits ws-bridge-ready when bridge outputs readiness marker', async () => {
      emitProxyReady()

      const bridgeReadySpy = vi.fn()
      manager.on('ws-bridge-ready', bridgeReadySpy)

      await manager.start()
      mockBridgeProcess.stdout.emit('data', Buffer.from('WebSocket-ADNL bridge started\n'))

      expect(bridgeReadySpy).toHaveBeenCalledWith(8081)

      manager.stop()
    })
  })

  describe('getStatus()', () => {
    it('returns correct status object when stopped', () => {
      const status = manager.getStatus()

      expect(status).toHaveProperty('status')
      expect(status).toHaveProperty('connected')

      expect(status).toHaveProperty('port')
      expect(status.status).toBe('stopped')
      expect(status.connected).toBe(false)
    })

    it('returns correct status after start', async () => {
      emitProxyReady()

      await manager.start()

      const status = manager.getStatus()
      expect(status.status).toBe('connected')
      expect(status.port).toBe(8080)

      manager.stop()
    })
  })

  describe('getProxyUrl()', () => {
    it('returns correct proxy URL after start', async () => {
      emitProxyReady()

      await manager.start()

      expect(manager.getProxyUrl()).toBe('http://127.0.0.1:8080')

      manager.stop()
    })
  })
})

describe('buildProxyArgs', () => {
  const base = { resolveEth: true, ethRpc: '', resolveSol: true, solRpc: '' }

  it('always includes -addr', () => {
    const args = buildProxyArgs(8080, base as any)
    expect(args).toContain('-addr')
    expect(args).toContain('127.0.0.1:8080')
  })

  it('always blocks ordinary HTTP requests', () => {
    expect(buildProxyArgs(8080, base as any)).toContain('-no-http')
  })

  it('passes a bounded native verbosity', () => {
    expect(buildProxyArgs(8080, base as any, 3)).toEqual(expect.arrayContaining(['-verbosity', '3']))
    expect(buildProxyArgs(8080, base as any, 9)).toEqual(expect.arrayContaining(['-verbosity', '3']))
  })

  it('adds -no-eth when resolveEth is false', () => {
    const args = buildProxyArgs(8080, { ...base, resolveEth: false } as any)
    expect(args).toContain('-no-eth')
    expect(args).not.toContain('-eth-rpc')
  })

  it('adds -eth-rpc when resolveEth is true and ethRpc is set', () => {
    const args = buildProxyArgs(8080, { ...base, resolveEth: true, ethRpc: 'https://eth.example.com' } as any)
    expect(args).toContain('-eth-rpc')
    expect(args).toContain('https://eth.example.com')
    expect(args).not.toContain('-no-eth')
  })

  it('adds no eth flag when resolveEth is true and ethRpc is empty', () => {
    const args = buildProxyArgs(8080, { ...base, resolveEth: true, ethRpc: '' } as any)
    expect(args).not.toContain('-no-eth')
    expect(args).not.toContain('-eth-rpc')
  })

  it('adds -no-sol when resolveSol is false', () => {
    const args = buildProxyArgs(8080, { ...base, resolveSol: false } as any)
    expect(args).toContain('-no-sol')
    expect(args).not.toContain('-sol-rpc')
  })

  it('adds -sol-rpc when resolveSol is true and solRpc is set', () => {
    const args = buildProxyArgs(8080, { ...base, resolveSol: true, solRpc: 'https://sol.example.com' } as any)
    expect(args).toContain('-sol-rpc')
    expect(args).toContain('https://sol.example.com')
    expect(args).not.toContain('-no-sol')
  })

  it('trims whitespace from RPC URLs', () => {
    const args = buildProxyArgs(8080, { ...base, resolveEth: true, ethRpc: '  https://eth.example.com  ' } as any)
    expect(args).toContain('https://eth.example.com')
    expect(args).not.toContain('  https://eth.example.com  ')
  })
})

describe('Port Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [0, 8080], // Zero - invalid
    [123, 8080], // Below 1024 - invalid
    [1023, 8080], // Just below 1024 - invalid
    [65536, 8080], // Above 65535 - invalid
    ['8080' as any, 8080], // String - invalid type
    [null as any, 8080], // Null - invalid type
    [1024, 1024], // Minimum valid
    [8080, 8080], // Default valid
    [65535, 65535], // Maximum valid
  ])('port %s resolves to %s', async (input, expected) => {
    vi.mocked(spawn).mockReset()

    const testProxyProcess = createMockProcess()
    const testBridgeProcess = createMockProcess()
    vi.mocked(spawn)
      .mockReturnValueOnce(testProxyProcess as any)
      .mockReturnValueOnce(testBridgeProcess as any)

    setImmediate(() => {
      testProxyProcess.stderr.emit('data', Buffer.from('Starting proxy server'))
    })

    mockSettings.network.proxyPort = input

    const manager = new ProxyManager()
    await manager.start()

    const spawnCall = vi.mocked(spawn).mock.calls[0]
    const args = spawnCall[1] as string[]
    const addrArg = args[args.indexOf('-addr') + 1]

    expect(addrArg).toBe(`127.0.0.1:${expected}`)

    manager.stop()

    // Reset
    mockSettings.network.proxyPort = 8080
  })
})
