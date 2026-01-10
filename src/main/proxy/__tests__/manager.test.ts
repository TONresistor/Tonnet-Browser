/**
 * ProxyManager Tests
 * Tests for proxy lifecycle, sync checking, and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Create mock child process
const createMockProcess = () => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = 12345
  proc.kill = vi.fn(() => {
    proc.emit('exit', 0)
    return true
  })
  return proc
}

// Create mock HTTP response
const createMockResponse = (statusCode: number) => {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number
    resume: ReturnType<typeof vi.fn>
  }
  res.statusCode = statusCode
  res.resume = vi.fn()
  return res
}

// Create mock HTTP request
const createMockRequest = () => {
  const req = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  req.end = vi.fn()
  req.destroy = vi.fn()
  return req
}

// Mock settings
const mockSettings = {
  network: {
    proxyPort: 8080,
    connectionTimeout: 5,
    syncCheckInterval: 100,
  },
  advanced: {
    proxyVerbosity: 2,
    syncTestDomain: 'test.ton',
  },
}

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('http', () => ({
  default: {
    request: vi.fn(),
  },
}))

vi.mock('../../settings', () => ({
  getSetting: vi.fn((category: string) => mockSettings[category as keyof typeof mockSettings]),
}))

vi.mock('../../utils/paths', () => ({
  getBinaryPath: vi.fn(() => '/mock/bin/tonnet-proxy'),
}))

// Import after mocks
import { ProxyManager } from '../manager'
import { spawn } from 'child_process'
import http from 'http'

describe('ProxyManager', () => {
  let manager: ProxyManager
  let mockProcess: ReturnType<typeof createMockProcess>

  beforeEach(() => {
    vi.clearAllMocks()
    mockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProcess as any)
    manager = new ProxyManager()
  })

  afterEach(() => {
    manager.stop()
  })

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
    it('spawns proxy process with correct arguments', async () => {
      // Simulate "Proxy listening" output from tonnet-proxy
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening on http://localhost:8080'))
      })

      await manager.start()

      expect(spawn).toHaveBeenCalledWith(
        '/mock/bin/tonnet-proxy',
        expect.arrayContaining([
          '--direct',
          '--listen', '127.0.0.1:8080',
        ])
      )

      manager.stop()
    })

    it('throws if proxy already running', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening on http://localhost:8080'))
      })

      await manager.start()

      await expect(manager.start()).rejects.toThrow('Proxy already running')

      manager.stop()
    })

    it('emits "status" event with "starting"', () => {
      const statusSpy = vi.fn()
      manager.on('status', statusSpy)

      // Don't await - just trigger start
      manager.start().catch(() => {})

      expect(statusSpy).toHaveBeenCalledWith('starting')
    })

    it('uses default port 8080 for invalid port below 1024', async () => {
      // Set invalid port below minimum
      mockSettings.network.proxyPort = 123

      const newMockProcess = createMockProcess()
      vi.mocked(spawn).mockReturnValue(newMockProcess as any)

      setImmediate(() => {
        newMockProcess.stdout.emit('data', Buffer.from('Proxy listening on http://localhost:8080'))
      })

      const newManager = new ProxyManager()
      await newManager.start()

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--listen', '127.0.0.1:8080'])
      )

      newManager.stop()
      // Reset
      mockSettings.network.proxyPort = 8080
    })
  })

  describe('stop()', () => {
    it('kills the process', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      await manager.start()
      manager.stop()

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('emits "disconnected" event', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      const disconnectSpy = vi.fn()
      manager.on('disconnected', disconnectSpy)

      await manager.start()
      manager.stop()

      expect(disconnectSpy).toHaveBeenCalled()
    })

    it('sets status to "stopped"', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      await manager.start()
      manager.stop()

      expect(manager.getStatus().status).toBe('stopped')
    })

    it('does nothing if not running', () => {
      expect(() => manager.stop()).not.toThrow()
      expect(mockProcess.kill).not.toHaveBeenCalled()
    })
  })

  describe('waitForReady() timeout', () => {
    it('throws timeout error if proxy never outputs "Proxy listening"', async () => {
      // Set short timeout for test
      mockSettings.network.connectionTimeout = 1

      const newMockProcess = createMockProcess()
      vi.mocked(spawn).mockReturnValue(newMockProcess as any)

      const newManager = new ProxyManager()

      await expect(newManager.start()).rejects.toThrow('Proxy failed to start within timeout')

      // Reset
      mockSettings.network.connectionTimeout = 5
    }, 10000)

    it('succeeds when proxy outputs "Proxy listening"', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      await expect(manager.start()).resolves.toBeUndefined()

      manager.stop()
    })
  })

  describe('Process Events', () => {
    it('emits "log" on stdout data', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      const logSpy = vi.fn()
      manager.on('log', logSpy)

      await manager.start()
      mockProcess.stdout.emit('data', Buffer.from('Test log message'))

      expect(logSpy).toHaveBeenCalledWith('Test log message')

      manager.stop()
    })

    it('emits "error" on stderr data', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      const errorSpy = vi.fn()
      manager.on('error', errorSpy)

      await manager.start()
      mockProcess.stderr.emit('data', Buffer.from('Error message'))

      expect(errorSpy).toHaveBeenCalledWith('Error message')

      manager.stop()
    })

    it('handles process exit', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      const exitSpy = vi.fn()
      manager.on('exit', exitSpy)

      await manager.start()
      mockProcess.emit('exit', 1)

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(manager.getStatus().status).toBe('stopped')
      expect(manager.isRunning()).toBe(false)
    })
  })

  describe('getStatus()', () => {
    it('returns correct status object when stopped', () => {
      const status = manager.getStatus()

      expect(status).toHaveProperty('status')
      expect(status).toHaveProperty('connected')
      expect(status).toHaveProperty('syncing')
      expect(status).toHaveProperty('port')
      expect(status.status).toBe('stopped')
      expect(status.connected).toBe(false)
      expect(status.syncing).toBe(false)
    })

    it('returns correct status after start', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      await manager.start()

      const status = manager.getStatus()
      expect(status.status).toBe('syncing')
      expect(status.port).toBe(8080)

      manager.stop()
    })
  })

  describe('getProxyUrl()', () => {
    it('returns correct proxy URL after start', async () => {
      setImmediate(() => {
        mockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
      })

      await manager.start()

      expect(manager.getProxyUrl()).toBe('http://127.0.0.1:8080')

      manager.stop()
    })
  })
})

describe('Port Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [0, 8080],        // Zero - invalid
    [123, 8080],      // Below 1024 - invalid
    [1023, 8080],     // Just below 1024 - invalid
    [65536, 8080],    // Above 65535 - invalid
    ['8080' as any, 8080],  // String - invalid type
    [null as any, 8080],    // Null - invalid type
    [1024, 1024],     // Minimum valid
    [8080, 8080],     // Default valid
    [65535, 65535],   // Maximum valid
  ])('port %s resolves to %s', async (input, expected) => {
    const testMockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(testMockProcess as any)

    setImmediate(() => {
      testMockProcess.stdout.emit('data', Buffer.from('Proxy listening'))
    })

    mockSettings.network.proxyPort = input

    const manager = new ProxyManager()
    await manager.start()

    const spawnCall = vi.mocked(spawn).mock.calls[0]
    const args = spawnCall[1] as string[]
    const listenIndex = args.indexOf('--listen')
    const addr = args[listenIndex + 1]

    expect(addr).toBe(`127.0.0.1:${expected}`)

    manager.stop()

    // Reset
    mockSettings.network.proxyPort = 8080
  })
})
