/**
 * StorageManager Tests
 * Tests for storage daemon lifecycle, bag operations, and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockProcess } from '../../__tests__/mock-child-process'

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

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/mock-userdata') },
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    chmodSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
}))
vi.mock('fs/promises', () => ({ mkdir: vi.fn(() => Promise.resolve()) }))

// Mock StorageHTTPClient with a real class
const mockClientInstances: any[] = []
let mockPingResponse = true
vi.mock('../http-client', () => {
  return {
    StorageHTTPClient: class MockStorageHTTPClient {
      ping = vi.fn(() => Promise.resolve(mockPingResponse))
      listBags = vi.fn(() => Promise.resolve([]))
      addBag = vi.fn(() => Promise.resolve({ ok: true }))
      removeBag = vi.fn(() => Promise.resolve({ ok: true }))
      stopBag = vi.fn(() => Promise.resolve({ ok: true }))
      getBagDetails = vi.fn(() =>
        Promise.resolve({
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
        })
      )

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
import { mkdir } from 'fs/promises'

describe('StorageManager', () => {
  let manager: StorageManager
  let mockProcess: ReturnType<typeof createMockProcess>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mkdir).mockResolvedValue(undefined)
    mockClientInstances.length = 0
    mockPingResponse = true
    mockProcess = createMockProcess()
    vi.mocked(spawn).mockReturnValue(mockProcess as any)
    manager = new StorageManager()
  })

  afterEach(async () => {
    await manager.stop()
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
          '-api',
          '127.0.0.1:5555',
          '-db',
          expect.stringContaining('db'),
          '-network-config',
          '/mock/config/global.config.json',
          '-verbosity',
          '2',
        ]),
        { windowsHide: true }
      )
    })

    it('is idempotent if daemon is already running', async () => {
      await manager.start()
      await expect(manager.start()).resolves.toBeUndefined()

      expect(spawn).toHaveBeenCalledOnce()
      expect(mockClientInstances).toHaveLength(1)
    })

    it('shares one start before directory creation completes', async () => {
      let releaseDirectories: () => void = () => {}
      const directoriesReady = new Promise<string | undefined>((resolve) => {
        releaseDirectories = () => resolve(undefined)
      })
      vi.mocked(mkdir).mockReturnValue(directoriesReady)

      const first = manager.start()
      const second = manager.start()

      expect(first).toBe(second)
      await vi.waitFor(() => expect(mkdir).toHaveBeenCalledTimes(2))

      releaseDirectories()
      await Promise.all([first, second])

      expect(spawn).toHaveBeenCalledOnce()
      expect(mockClientInstances).toHaveLength(1)
    })

    it('tears down the spawned child when readiness fails, so a retry is not blocked', async () => {
      mockPingResponse = false
      const startP = manager.start()
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
      // Daemon crashes before its HTTP API answers → waitForReady rejects.
      mockProcess.emit('exit', 1)
      await expect(startP).rejects.toBeDefined()

      // The child was reaped (this.process nulled), so the retry proceeds
      // instead of throwing 'already running', and now succeeds.
      mockPingResponse = true
      await expect(manager.start()).resolves.toBeUndefined()
    })

    it('clears a failed shared start so a retry can succeed', async () => {
      mockPingResponse = false
      const first = manager.start()
      const second = manager.start()
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())

      expect(first).toBe(second)
      mockProcess.emit('exit', 1)
      await expect(first).rejects.toBeDefined()
      await expect(second).rejects.toBeDefined()

      mockPingResponse = true
      mockProcess = createMockProcess()
      vi.mocked(spawn).mockReturnValue(mockProcess as any)

      await expect(manager.start()).resolves.toBeUndefined()
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(mockClientInstances).toHaveLength(2)
    })

    it('creates storage directories if missing', async () => {
      await manager.start()

      expect(mkdir).toHaveBeenCalledTimes(2)
    })

    it('emits "started" event on success', async () => {
      const startedSpy = vi.fn()
      manager.on('started', startedSpy)

      await manager.start()

      expect(startedSpy).toHaveBeenCalled()
    })

    it('waits for API to be ready', async () => {
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
      await manager.stop()

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('emits "stopped" event', async () => {
      const stoppedSpy = vi.fn()
      manager.on('stopped', stoppedSpy)

      await manager.start()
      await manager.stop()

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

    it('shares one stop while process termination is pending', async () => {
      await manager.start()
      mockProcess.kill.mockReturnValue(true)

      const first = manager.stop()
      const second = manager.stop()

      expect(first).toBe(second)
      await vi.waitFor(() => expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM'))
      mockProcess.emit('exit', 0)
      await Promise.all([first, second])
    })

    it('waits for process termination before spawning a replacement', async () => {
      await manager.start()
      const firstProcess = mockProcess
      const secondProcess = createMockProcess()
      firstProcess.kill.mockReturnValue(true)
      vi.mocked(spawn).mockReturnValue(secondProcess as any)

      const stopping = manager.stop()
      const restarting = manager.start()

      await vi.waitFor(() => expect(firstProcess.kill).toHaveBeenCalledWith('SIGTERM'))
      expect(spawn).toHaveBeenCalledOnce()
      firstProcess.emit('exit', 0)

      await stopping
      await restarting
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(manager.getStatus().running).toBe(true)
    })

    it('finishes running after start, stop, start during readiness', async () => {
      mockPingResponse = false
      const firstProcess = mockProcess
      const secondProcess = createMockProcess()
      firstProcess.kill.mockReturnValue(true)

      const firstStart = manager.start().catch((error) => error)
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())

      const stopping = manager.stop()
      mockPingResponse = true
      vi.mocked(spawn).mockReturnValue(secondProcess as any)
      const restarting = manager.start()

      await vi.waitFor(() => expect(firstProcess.kill).toHaveBeenCalledWith('SIGTERM'))
      expect(spawn).toHaveBeenCalledOnce()
      firstProcess.emit('exit', 0)

      expect(await firstStart).toBeInstanceOf(Error)
      await stopping
      await restarting
      expect(spawn).toHaveBeenCalledTimes(2)
      expect(manager.getStatus().running).toBe(true)
      expect(manager.getClient()).not.toBeNull()
    })

    it('cancels a start that is waiting for directory creation', async () => {
      let releaseDirectories: () => void = () => {}
      const directoriesReady = new Promise<string | undefined>((resolve) => {
        releaseDirectories = () => resolve(undefined)
      })
      vi.mocked(mkdir).mockReturnValue(directoriesReady)

      const start = manager.start()
      manager.stop()
      releaseDirectories()

      await expect(start).rejects.toThrow('Storage daemon start aborted')
      expect(spawn).not.toHaveBeenCalled()
      expect(manager.getStatus().running).toBe(false)
      expect(manager.getClient()).toBeNull()
    })

    it('cancels a start that is waiting for API readiness', async () => {
      mockPingResponse = false
      const start = manager.start()
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())

      manager.stop()

      await expect(start).rejects.toThrow('Readiness wait aborted')
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM')
      expect(manager.getStatus().running).toBe(false)
      expect(manager.getClient()).toBeNull()
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
      mockProcess.stdout.emit('data', Buffer.from('Storage log message\n'))

      expect(logSpy).toHaveBeenCalledWith('Storage log message')
    })

    it('does not promote plain stderr but emits explicit native errors', async () => {
      const errorSpy = vi.fn()
      manager.on('error', errorSpy)

      await manager.start()
      mockProcess.stderr.emit('data', Buffer.from('plain stderr\n'))
      expect(errorSpy).not.toHaveBeenCalled()
      mockProcess.stderr.emit('data', Buffer.from('ERROR Storage failed\n'))

      expect(errorSpy).toHaveBeenCalledWith('ERROR Storage failed')
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
