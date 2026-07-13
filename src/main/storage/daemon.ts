/**
 * TON Storage daemon manager.
 * Spawns and manages the tonutils-storage process.
 */

import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'
import { getBinaryPath, getStoragePath, getConfigPath } from '../utils/paths'
import { validatePort, validateVerbosity } from '../utils/validators'
import { StorageHTTPClient, BagInfo } from './http-client'
import type { StorageBag } from '../../shared/types'
import { getSetting, getDownloadPath } from '../settings'
import { PING_RETRY_DELAY_MS, PING_MAX_ATTEMPTS } from './constants'
import { NativeProcessSupervisor } from '../native-process/supervisor'
import { createLogger, RepetitionAggregator } from '../../shared/logger'
const log = createLogger('storage')
import { mkdir } from 'fs/promises'
import path from 'path'

/** Typed event contract for StorageManager. */
interface StorageManagerEventMap {
  log: [message: string]
  error: [message: string]
  exit: [code: number | null]
  started: []
  stopped: []
  'bags-updated': [bags: StorageBag[]]
}

/** Thrown by operations that require a running storage daemon when it isn't. */
export class StorageNotRunningError extends Error {
  constructor() {
    super('Storage daemon not running')
    this.name = 'StorageNotRunningError'
  }
}

// Declaration merging gives on/once/off/emit typed overloads of the inherited
// EventEmitter methods without changing runtime behavior. The merge only refines
// existing method signatures, so the no-unsafe-declaration-merging footgun (an
// interface declaring members the class never implements) does not apply.
/* eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging */
export interface StorageManager {
  on<E extends keyof StorageManagerEventMap>(event: E, listener: (...args: StorageManagerEventMap[E]) => void): this
  once<E extends keyof StorageManagerEventMap>(event: E, listener: (...args: StorageManagerEventMap[E]) => void): this
  off<E extends keyof StorageManagerEventMap>(event: E, listener: (...args: StorageManagerEventMap[E]) => void): this
  emit<E extends keyof StorageManagerEventMap>(event: E, ...args: StorageManagerEventMap[E]): boolean
}

/* eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging */
export class StorageManager extends EventEmitter {
  private readonly supervisor = new NativeProcessSupervisor()
  private port: number = 0
  private dbPath: string
  private isRunning = false
  private client: StorageHTTPClient | null = null
  private pollInterval: NodeJS.Timeout | null = null
  private lastBagsJson = ''
  private readonly pollFailures = new RepetitionAggregator(log)
  private lifecycleTail: Promise<void> = Promise.resolve()
  private desiredRunning = false
  private startFlight: Promise<void> | null = null
  private stopFlight: Promise<void> | null = null
  private startAbortController: AbortController | null = null

  constructor() {
    super()
    this.dbPath = path.join(getStoragePath(), 'db') // DB stays in userData
  }

  // Download destination, always read live from settings (single source of truth).
  private get storagePath(): string {
    return getDownloadPath()
  }

  private loadSettings() {
    const network = getSetting('network')
    const storage = getSetting('storage')
    const advanced = getSetting('advanced')
    this.port = network.storagePort
    return { network, storage, advanced }
  }

  start(): Promise<void> {
    if (this.desiredRunning) {
      if (this.startFlight) return this.startFlight
      if (this.isRunning && this.supervisor.isRunning) return Promise.resolve()
    }

    this.desiredRunning = true
    const controller = new AbortController()
    this.startAbortController = controller
    const flight = this.enqueueLifecycle(() => this.startOnce(controller.signal)).finally(() => {
      if (this.startFlight === flight) this.startFlight = null
      if (this.startAbortController === controller) this.startAbortController = null
    })
    this.startFlight = flight
    return flight
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const flight = this.lifecycleTail.then(operation)
    this.lifecycleTail = flight.catch(() => {})
    return flight
  }

  private async startOnce(signal: AbortSignal): Promise<void> {
    const startedAt = Date.now()
    this.throwIfStartAborted(signal)

    const { advanced } = this.loadSettings()

    // Ensure storage directories exist
    await Promise.all([mkdir(this.storagePath, { recursive: true }), mkdir(this.dbPath, { recursive: true })])
    this.throwIfStartAborted(signal)

    const binPath = getBinaryPath('tonutils-storage')
    const configPath = getConfigPath()

    // Security: Validate spawn arguments (storage default port is 5555)
    const safePort = validatePort(this.port, 5555)
    const safeVerbosity = validateVerbosity(advanced.storageVerbosity)
    this.port = safePort

    // Generate ephemeral auth credentials for this session
    const apiLogin = randomBytes(16).toString('hex')
    const apiPassword = randomBytes(32).toString('hex')

    log.debug(`Starting tonutils-storage from: ${binPath}`)
    log.debug(`Config: ${configPath}`)
    log.debug(`DB: ${this.dbPath}`)
    log.debug(`API port: ${safePort}`)
    log.debug(`Verbosity: ${safeVerbosity}`)

    // Build spawn arguments
    const { storage } = this.loadSettings()
    const args = [
      '-daemon',
      '-api',
      `127.0.0.1:${safePort}`,
      '-api-login',
      apiLogin,
      '-api-password',
      apiPassword,
      '-db',
      this.dbPath,
      '-network-config',
      configPath,
      '-verbosity',
      String(safeVerbosity),
    ]
    if (storage.downloadSpeedLimit > 0) {
      args.push('-limit-download', String(storage.downloadSpeedLimit))
    }
    if (storage.uploadSpeedLimit > 0) {
      args.push('-limit-upload', String(storage.uploadSpeedLimit))
    }

    this.supervisor.start({
      name: 'tonutils-storage',
      command: binPath,
      args,
      options: { windowsHide: true },
      onLine: ({ line, level }) => {
        this.emit('log', line)
        if (level === 'error') this.emit('error', line)
      },
      onExit: (code) => {
        log.info(`Storage daemon exited with code: ${code}`)
        this.isRunning = false
        this.client = null
        this.stopPolling()
        this.emit('exit', code)
      },
      onError: (error) => {
        this.isRunning = false
        this.client = null
        log.error(`Failed to start storage daemon: ${error.message}`)
        this.emit('error', error.message)
      },
    })

    // Create HTTP client with same auth credentials
    this.client = new StorageHTTPClient('127.0.0.1', this.port, { login: apiLogin, password: apiPassword })

    // Wait for API to be ready. On failure, tear down the spawned child so it
    // cannot squat port 5555 and block the next start() with 'already running'.
    try {
      await this.waitForReady(PING_MAX_ATTEMPTS, signal)
      this.throwIfStartAborted(signal)
    } catch (err) {
      await this.teardown()
      throw err
    }

    this.isRunning = true
    log.status('storage.ready', `storage ready · ${Date.now() - startedAt}ms`, {
      durationMs: Date.now() - startedAt,
      port: safePort,
    })
    this.emit('started')

    // Start polling for updates
    this.startPolling()
  }

  private throwIfStartAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new Error('Storage daemon start aborted')
  }

  private async waitForReady(maxAttempts = PING_MAX_ATTEMPTS, signal?: AbortSignal): Promise<void> {
    let attempts = 0
    await this.supervisor.waitForReady({
      intervalMs: PING_RETRY_DELAY_MS,
      timeoutMs: Math.max(PING_RETRY_DELAY_MS, maxAttempts * PING_RETRY_DELAY_MS),
      signal,
      probe: async () => {
        attempts += 1
        if (!this.client) return false
        try {
          const ready = await this.client.ping()
          if (ready) log.event('debug', 'storage.api.ready', `API ready after ${attempts} attempts`, { attempts })
          return ready
        } catch (error) {
          log.debug(`Ping attempt ${attempts} failed:`, error)
          return false
        }
      },
    })
  }

  private startPolling(): void {
    const { storage } = this.loadSettings()
    const interval = storage.pollingInterval
    this.lastBagsJson = ''

    this.pollInterval = setInterval(async () => {
      if (!this.client || !this.isRunning) return
      try {
        const bags = await this.client.listBags()
        this.pollFailures.recovered('bags', 'storage.poll.restored', 'storage polling restored')

        // Auto-stop seeding bags when seeding is disabled
        const { storage: storageSettings } = this.loadSettings()
        if (!storageSettings.seedingEnabled) {
          for (const bag of bags) {
            if (bag.completed && bag.active) {
              log.debug(`Seeding disabled: stopping bag ${bag.bag_id.slice(0, 8)}...`)
              await this.client.stopBag(bag.bag_id).catch(() => {})
            }
          }
        }

        const mapped = bags.map((b) => this.mapBagInfo(b, storageSettings.seedingEnabled))
        const snapshot = JSON.stringify(mapped)
        if (snapshot !== this.lastBagsJson) {
          this.lastBagsJson = snapshot
          this.emit('bags-updated', mapped)
        }
      } catch (err) {
        this.pollFailures.record('bags', 'storage.poll.failed', 'storage polling failed', { error: err })
      }
    }, interval)
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  private mapBagInfo(info: BagInfo, seedingEnabled: boolean): StorageBag {
    let status: StorageBag['status'] = 'downloading'
    if (info.completed && info.active) {
      status = 'seeding'
    } else if (info.completed && !info.active) {
      // Completed but paused: show 'seeding' if seeding is globally enabled (temporarily paused),
      // show 'paused' if seeding is disabled (expected state)
      status = seedingEnabled ? 'paused' : 'seeding'
    } else if (!info.active) {
      status = 'paused'
    }

    return {
      id: info.bag_id,
      name: info.description || info.dir_name || `Bag ${info.bag_id.slice(0, 8)}...`,
      size: info.size,
      downloaded: info.downloaded,
      downloadSpeed: info.download_speed,
      uploadSpeed: info.upload_speed,
      peers: info.peers,
      filesCount: info.files_count,
      status,
    }
  }

  stop(): Promise<void> {
    if (!this.desiredRunning && this.stopFlight) return this.stopFlight

    const shouldEmitStopped = this.isRunning || this.client !== null || this.supervisor.isRunning
    this.desiredRunning = false
    this.startAbortController?.abort()
    this.stopPolling()
    this.client = null
    this.isRunning = false
    let processStop: Promise<void> | null = null
    if (this.supervisor.isRunning) {
      log.info('Stopping storage daemon...')
      processStop = this.supervisor.stop()
    }

    const flight = this.enqueueLifecycle(async () => {
      if (processStop) await processStop
      await this.teardown()
      if (shouldEmitStopped) this.emit('stopped')
    }).finally(() => {
      if (this.stopFlight === flight) this.stopFlight = null
    })
    this.stopFlight = flight
    return flight
  }

  private async teardown(): Promise<void> {
    this.stopPolling()
    this.client = null
    this.isRunning = false
    if (this.supervisor.isRunning) {
      log.info('Stopping storage daemon...')
    }
    await this.supervisor.stop()
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      storagePath: this.storagePath,
    }
  }

  getClient(): StorageHTTPClient | null {
    return this.client
  }

  /** Return the HTTP client or throw StorageNotRunningError. For ops that can't degrade gracefully. */
  private requireClient(): StorageHTTPClient {
    if (!this.client) throw new StorageNotRunningError()
    return this.client
  }

  // Bag operations
  async addBag(bagId: string, downloadPath?: string): Promise<StorageBag> {
    const client = this.requireClient()

    await client.addBag({
      bag_id: bagId,
      path: downloadPath || this.storagePath,
      download_all: true,
    })

    // Return initial bag state
    return {
      id: bagId,
      name: `Bag ${bagId.slice(0, 8)}...`,
      size: 0,
      downloaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      filesCount: 0,
      status: 'downloading',
    }
  }

  async removeBag(bagId: string, withFiles = false): Promise<boolean> {
    const client = this.requireClient()

    const result = await client.removeBag({
      bag_id: bagId,
      with_files: withFiles,
    })
    return result.ok
  }

  async listBags(): Promise<StorageBag[]> {
    if (!this.client) {
      return []
    }

    const { storage } = this.loadSettings()
    const bags = await this.client.listBags()
    return bags.map((b) => this.mapBagInfo(b, storage.seedingEnabled))
  }

  async resumeSeeding(): Promise<void> {
    if (!this.client) return
    try {
      const bags = await this.client.listBags()
      for (const bag of bags) {
        if (bag.completed && !bag.active) {
          log.debug(`Seeding enabled: resuming bag ${bag.bag_id.slice(0, 8)}...`)
          await this.client
            .addBag({
              bag_id: bag.bag_id,
              path: this.storagePath,
              download_all: true,
            })
            .catch(() => {})
        }
      }
    } catch (err) {
      log.error(`Resume seeding error: ${String(err)}`)
    }
  }

  async pauseBag(bagId: string): Promise<boolean> {
    const client = this.requireClient()

    const result = await client.stopBag(bagId)
    return result.ok
  }

  async getBagDetails(bagId: string) {
    const client = this.requireClient()

    return client.getBagDetails(bagId)
  }
}

// Singleton removed: use ServiceRegistry from services.ts
