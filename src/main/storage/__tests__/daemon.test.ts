/**
 * StorageManager Tests
 * Tests for storage daemon lifecycle, bag operations, and error handling
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

// Mock settings
const mockSettings = {
  network: {
    storagePort: 5555,
  },
  storage: {
    downloadPath: '/mock/downloads',
    pollingInterval: 1000,
  },
  advanced: {
    storageVerbosity: 2,
  },
}

// Mock modules
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}))

// Mock StorageHTTPClient with a real class
const mockClientInstances: any[] = []
vi.mock('../http-client', () => {
  return {
    StorageHTTPClient: class MockStorageHTTPClient {
      ping = vi.fn(() => Promise.resolve(true))
      listBags = vi.fn(() => Promise.resolve([]))
      addBag = vi.fn(() => Promise.resolve({ ok: true }))
      removeBag = vi.fn(() => Promise.resolve({ ok: true }))
      stopBag = vi.fn(() => Promise.resolve({ ok: true }))
      getBagDetails = vi.fn(() => Promise.resolve({
        bag_id: 'test123',
        description: 'Test bag',
        files: [],
        peers: [],
        merkle_hash: 'abc',
        piece_size: 128,
        path: '/mock/path',
        downloaded: 0,
        size: 1000,
        active: true,
        seeding: false,
      }))

      constructor() {
        mockClientInstances.push(this)
      }
    },
  }
})

// Helper to get the last created mock client
const getLastMockClient = () => mockClientInstances[mockClientInstances.length - 1]

vi.mock('../../settings', () => ({
  getSetting: vi.fn((category: string) => mockSettings[category as keyof typeof mockSettings]),
  getDownloadPath: vi.fn(() => '/mock/downloads'),
}))

vi.mock('../../utils/paths', () => ({
  getBinaryPath: vi.fn(() => '/mock/bin/tonutils-storage'),
  getStoragePath: vi.fn(() => '/mock/storage'),
  getConfigPath: vi.fn(() => '/mock/config/global.config.json'),
}))

// Import after mocks
import { StorageManager } from '../daemon'
import { spawn } from 'child_process'
import fs from 'fs'

describe('StorageManager', () => {
  let manager: StorageManager
  let mockProcess: ReturnType<typeof createMockProcess>

  beforeEach(() => {
    vi.clearAllMocks()
    mockClientInstances.length = 0
    mockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProcess as any)
    manager = new StorageManager()
  })

  afterEach(() => {
    manager.stop()
  })

  describe('Initial State', () => {
    it('starts with running = false', () => {
      expect(manager.getStatus().running).toBe(false)
    })

    it('has null client initially', () => {
      expect(manager.getClient()).toBeNull()
    })
  })

  describe('start()', () => {
    it('spawns storage daemon with correct arguments', async () => {
      await manager.start()

      expect(spawn).toHaveBeenCalledWith(
        '/mock/bin/tonutils-storage',
        expect.arrayContaining([
          '-daemon',
          '-api', '127.0.0.1:5555',
          '-db', expect.stringContaining('db'),
          '-network-config', '/mock/config/global.config.json',
          '-verbosity', '2',
        ])
      )
    })

    it('throws if daemon already running', async () => {
      await manager.start()
      await expect(manager.start()).rejects.toThrow('Storage daemon already running')
    })

    it('creates storage directories if missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await manager.start()

      expect(fs.mkdirSync).toHaveBeenCalled()
    })

    it('emits "started" event on success', async () => {
      const startedSpy = vi.fn()
      manager.on('started', startedSpy)

      await manager.start()

      expect(startedSpy).toHaveBeenCalled()
    })

    it('waits for API to be ready', async () => {
      let pingCalls = 0
      // Will be called after client is created
      vi.mocked(spawn).mockImplementation(() => {
        mockProcess = createMockProcess()
        return mockProcess as any
      })

      // Create manager and start - ping will be called on the mock client
      await manager.start()

      // Client should have been created and ping called
      expect(getLastMockClient()?.ping).toHaveBeenCalled()
    })
  })

  describe('stop()', () => {
    it('kills the process', async () => {
      await manager.start()
      manager.stop()

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('emits "stopped" event', async () => {
      const stoppedSpy = vi.fn()
      manager.on('stopped', stoppedSpy)

      await manager.start()
      manager.stop()

      expect(stoppedSpy).toHaveBeenCalled()
    })

    it('sets running to false', async () => {
      await manager.start()
      expect(manager.getStatus().running).toBe(true)

      manager.stop()
      expect(manager.getStatus().running).toBe(false)
    })

    it('does nothing if not running', () => {
      expect(() => manager.stop()).not.toThrow()
      expect(mockProcess.kill).not.toHaveBeenCalled()
    })
  })

  describe('setStoragePath()', () => {
    it('updates the storage path', () => {
      manager.setStoragePath('/new/path')
      expect(manager.getStatus().storagePath).toBe('/new/path')
    })
  })

  describe('Bag Operations', () => {
    beforeEach(async () => {
      await manager.start()
    })

    describe('addBag()', () => {
      it('calls client.addBag with correct params', async () => {
        await manager.addBag('abc123')

        expect(getLastMockClient().addBag).toHaveBeenCalledWith({
          bag_id: 'abc123',
          path: '/mock/downloads',
          download_all: true,
        })
      })

      it('uses custom download path if provided', async () => {
        await manager.addBag('abc123', '/custom/path')

        expect(getLastMockClient().addBag).toHaveBeenCalledWith({
          bag_id: 'abc123',
          path: '/custom/path',
          download_all: true,
        })
      })

      it('returns initial bag state', async () => {
        const bag = await manager.addBag('abc123')

        expect(bag.id).toBe('abc123')
        expect(bag.status).toBe('downloading')
      })

      it('throws if daemon not running', async () => {
        manager.stop()
        await expect(manager.addBag('abc123')).rejects.toThrow('Storage daemon not running')
      })
    })

    describe('removeBag()', () => {
      it('calls client.removeBag with correct params', async () => {
        await manager.removeBag('abc123')

        expect(getLastMockClient().removeBag).toHaveBeenCalledWith({
          bag_id: 'abc123',
          with_files: false,
        })
      })

      it('passes withFiles flag', async () => {
        await manager.removeBag('abc123', true)

        expect(getLastMockClient().removeBag).toHaveBeenCalledWith({
          bag_id: 'abc123',
          with_files: true,
        })
      })

      it('throws if daemon not running', async () => {
        manager.stop()
        await expect(manager.removeBag('abc123')).rejects.toThrow('Storage daemon not running')
      })
    })

    describe('listBags()', () => {
      it('returns empty array if no client', async () => {
        manager.stop()
        const bags = await manager.listBags()
        expect(bags).toEqual([])
      })

      it('maps bag info correctly', async () => {
        getLastMockClient().listBags.mockResolvedValue([
          {
            bag_id: 'bag1',
            description: 'Test Bag',
            downloaded: 500,
            size: 1000,
            download_speed: 100,
            upload_speed: 50,
            files_count: 3,
            dir_name: 'test-dir',
            completed: false,
            header_loaded: true,
            info_loaded: true,
            active: true,
            seeding: false,
            peers: 5,
          },
        ])

        const bags = await manager.listBags()

        expect(bags[0].id).toBe('bag1')
        expect(bags[0].name).toBe('Test Bag')
        expect(bags[0].downloaded).toBe(500)
        expect(bags[0].size).toBe(1000)
        expect(bags[0].peers).toBe(5)
        expect(bags[0].status).toBe('downloading')
      })

      it('uses dir_name as fallback name', async () => {
        getLastMockClient().listBags.mockResolvedValue([
          {
            bag_id: 'bag1',
            description: '',
            downloaded: 0,
            size: 0,
            download_speed: 0,
            upload_speed: 0,
            files_count: 0,
            dir_name: 'my-folder',
            completed: false,
            header_loaded: true,
            info_loaded: true,
            active: true,
            seeding: false,
            peers: 0,
          },
        ])

        const bags = await manager.listBags()
        expect(bags[0].name).toBe('my-folder')
      })

      it('sets status to paused when not active', async () => {
        getLastMockClient().listBags.mockResolvedValue([
          {
            bag_id: 'bag1',
            description: 'Paused bag',
            downloaded: 0,
            size: 100,
            download_speed: 0,
            upload_speed: 0,
            files_count: 1,
            dir_name: '',
            completed: false,
            header_loaded: true,
            info_loaded: true,
            active: false,
            seeding: false,
            peers: 0,
          },
        ])

        const bags = await manager.listBags()
        expect(bags[0].status).toBe('paused')
      })

      it('sets status to seeding when completed', async () => {
        getLastMockClient().listBags.mockResolvedValue([
          {
            bag_id: 'bag1',
            description: 'Seeding bag',
            downloaded: 100,
            size: 100,
            download_speed: 0,
            upload_speed: 50,
            files_count: 1,
            dir_name: '',
            completed: true,
            header_loaded: true,
            info_loaded: true,
            active: true,
            seeding: true,
            peers: 2,
          },
        ])

        const bags = await manager.listBags()
        expect(bags[0].status).toBe('seeding')
      })
    })

    describe('pauseBag()', () => {
      it('calls client.stopBag', async () => {
        await manager.pauseBag('abc123')
        expect(getLastMockClient().stopBag).toHaveBeenCalledWith('abc123')
      })

      it('throws if daemon not running', async () => {
        manager.stop()
        await expect(manager.pauseBag('abc123')).rejects.toThrow('Storage daemon not running')
      })
    })

    describe('getBagDetails()', () => {
      it('calls client.getBagDetails', async () => {
        await manager.getBagDetails('abc123')
        expect(getLastMockClient().getBagDetails).toHaveBeenCalledWith('abc123')
      })

      it('throws if daemon not running', async () => {
        manager.stop()
        await expect(manager.getBagDetails('abc123')).rejects.toThrow('Storage daemon not running')
      })
    })
  })

  describe('Process Events', () => {
    it('emits "log" on stdout data', async () => {
      const logSpy = vi.fn()
      manager.on('log', logSpy)

      await manager.start()
      mockProcess.stdout.emit('data', Buffer.from('Storage log message'))

      expect(logSpy).toHaveBeenCalledWith('Storage log message')
    })

    it('emits "error" on stderr data', async () => {
      const errorSpy = vi.fn()
      manager.on('error', errorSpy)

      await manager.start()
      mockProcess.stderr.emit('data', Buffer.from('Storage error'))

      expect(errorSpy).toHaveBeenCalledWith('Storage error')
    })

    it('handles process exit', async () => {
      const exitSpy = vi.fn()
      manager.on('exit', exitSpy)

      await manager.start()
      mockProcess.emit('exit', 1)

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(manager.getStatus().running).toBe(false)
    })
  })

  describe('getStatus()', () => {
    it('returns correct status when stopped', () => {
      const status = manager.getStatus()

      expect(status.running).toBe(false)
      expect(status).toHaveProperty('port')
      expect(status).toHaveProperty('storagePath')
    })

    it('returns correct status after start', async () => {
      await manager.start()

      const status = manager.getStatus()
      expect(status.running).toBe(true)
      expect(status.port).toBe(5555)
    })
  })

  describe('getClient()', () => {
    it('returns null when not running', () => {
      expect(manager.getClient()).toBeNull()
    })

    it('returns client after start', async () => {
      await manager.start()
      expect(manager.getClient()).not.toBeNull()
    })
  })
})

describe('Port Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClientInstances.length = 0
  })

  it.each([
    [0, 5555],
    [123, 5555],
    [1023, 5555],
    [65536, 5555],
    ['5555' as any, 5555],
    [null as any, 5555],
    [1024, 1024],
    [5555, 5555],
    [65535, 65535],
  ])('port %s resolves to %s', async (input, expected) => {
    const mockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProcess as any)

    mockSettings.network.storagePort = input

    const manager = new StorageManager()
    await manager.start()

    const spawnCall = vi.mocked(spawn).mock.calls[0]
    const args = spawnCall[1] as string[]
    const apiIndex = args.indexOf('-api')
    const api = args[apiIndex + 1]

    expect(api).toBe(`127.0.0.1:${expected}`)

    manager.stop()

    // Reset
    mockSettings.network.storagePort = 5555
  })
})
