/**
 * TON Storage daemon manager.
 * Spawns and manages the tonutils-storage process.
 */

import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'
import { getBinaryPath, getStoragePath, getConfigPath } from '../utils/paths'
import { validatePort, validateVerbosity } from '../utils/validators'
import { StorageHTTPClient, BagInfo } from './http-client'
import type { AppSettings, StorageBag } from '../../shared/types'
import { getSetting, getDownloadPath } from '../settings'
import { PING_RETRY_DELAY_MS, PING_MAX_ATTEMPTS } from './constants'
import { NativeProcessSupervisor } from '../native-process/supervisor'
import { createLogger, RepetitionAggregator } from '../../shared/logger'
const log = createLogger('storage')
import { mkdir } from 'fs/promises'
import path from 'path'

type StorageRuntimeSettings = {
  port: number
  downloadPath: string
  pollingInterval: number
  seedingEnabled: boolean
  downloadSpeedLimit: number
  uploadSpeedLimit: number
  storageVerbosity: number
}

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
  private readonly settingsAbortControllers = new Set<AbortController>()
  private appliedSettings: StorageRuntimeSettings | null = null

  constructor() {
    super()
    this.dbPath = path.join(getStoragePath(), 'db') // DB stays in userData
  }

  // Download destination, always read live from settings (single source of truth).
  private get storagePath(): string {
    return this.appliedSettings?.downloadPath ?? getDownloadPath()
  }

  private readRuntimeSettings(source?: AppSettings): StorageRuntimeSettings {
    const network = source?.network ?? getSetting('network')
    const storage = source?.storage ?? getSetting('storage')
    const advanced = source?.advanced ?? getSetting('advanced')
    return {
      port: validatePort(network.storagePort, 5555),
      downloadPath: storage.downloadPath,
      pollingInterval: storage.pollingInterval,
      seedingEnabled: storage.seedingEnabled,
      downloadSpeedLimit: storage.downloadSpeedLimit,
      uploadSpeedLimit: storage.uploadSpeedLimit,
      storageVerbosity: validateVerbosity(advanced.storageVerbosity),
    }
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

  private async startOnce(signal: AbortSignal, settings = this.readRuntimeSettings()): Promise<void> {
    const startedAt = Date.now()
    this.throwIfStartAborted(signal)

    // Ensure storage directories exist
    await Promise.all([mkdir(settings.downloadPath, { recursive: true }), mkdir(this.dbPath, { recursive: true })])
    this.throwIfStartAborted(signal)

    const binPath = getBinaryPath('tonutils-storage')
    const configPath = getConfigPath()

    // Security: Validate spawn arguments (storage default port is 5555)
    const safePort = settings.port
    const safeVerbosity = settings.storageVerbosity

    // Generate ephemeral auth credentials for this session
    const apiLogin = randomBytes(16).toString('hex')
    const apiPassword = randomBytes(32).toString('hex')

    log.debug(`Starting tonutils-storage from: ${binPath}`)
    log.debug(`Config: ${configPath}`)
    log.debug(`DB: ${this.dbPath}`)
    log.debug(`API port: ${safePort}`)
    log.debug(`Verbosity: ${safeVerbosity}`)

    // Build spawn arguments
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
    if (settings.downloadSpeedLimit > 0) {
      args.push('-limit-download', String(settings.downloadSpeedLimit))
    }
    if (settings.uploadSpeedLimit > 0) {
      args.push('-limit-upload', String(settings.uploadSpeedLimit))
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
    this.client = new StorageHTTPClient('127.0.0.1', safePort, { login: apiLogin, password: apiPassword })

    // Wait for API to be ready. On failure, tear down the spawned child so it
    // cannot squat port 5555 and block the next start() with 'already running'.
    try {
      await this.waitForReady(PING_MAX_ATTEMPTS, signal)
      this.throwIfStartAborted(signal)
    } catch (err) {
      await this.teardown()
      throw err
    }

    try {
      await this.applySeeding(settings.seedingEnabled, settings.downloadPath)
    } catch (error) {
      await this.teardown()
      throw error
    }
    this.isRunning = true
    this.port = safePort
    this.appliedSettings = settings
    log.status('storage.ready', `storage ready · ${Date.now() - startedAt}ms`, {
      durationMs: Date.now() - startedAt,
      port: safePort,
    })
    this.emit('started')

    // Start polling for updates
    this.startPolling(settings.pollingInterval, true)
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

  private startPolling(interval: number, resetSnapshot = false): void {
    this.stopPolling()
    if (resetSnapshot) this.lastBagsJson = ''

    this.pollInterval = setInterval(async () => {
      if (!this.client || !this.isRunning) return
      try {
        const bags = await this.client.listBags()
        this.pollFailures.recovered('bags', 'storage.poll.restored', 'storage polling restored')

        // Auto-stop seeding bags when seeding is disabled
        const seedingEnabled = this.appliedSettings?.seedingEnabled ?? getSetting('storage').seedingEnabled
        if (!seedingEnabled) {
          for (const bag of bags) {
            if (bag.completed && bag.active) {
              log.debug(`Seeding disabled: stopping bag ${bag.bag_id.slice(0, 8)}...`)
              await this.client.stopBag(bag.bag_id).catch(() => {})
            }
          }
        }

        const mapped = bags.map((b) => this.mapBagInfo(b, seedingEnabled))
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
    for (const controller of this.settingsAbortControllers) controller.abort()
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

  applySettingsChange(source?: AppSettings): Promise<void> {
    const controller = new AbortController()
    this.settingsAbortControllers.add(controller)
    const flight = this.enqueueLifecycle(() => this.applySettingsChangeOnce(controller.signal, source))
    return flight.finally(() => this.settingsAbortControllers.delete(controller))
  }

  private async applySettingsChangeOnce(signal: AbortSignal, source?: AppSettings): Promise<void> {
    if (signal.aborted) throw new Error('Storage settings apply aborted')
    if (!this.desiredRunning) return

    const next = this.readRuntimeSettings(source)
    if (!this.isRunning || !this.supervisor.isRunning) {
      await this.startOnce(signal, next)
      return
    }
    const current = this.appliedSettings
    const needsRestart =
      !current ||
      next.port !== current.port ||
      next.downloadSpeedLimit !== current.downloadSpeedLimit ||
      next.uploadSpeedLimit !== current.uploadSpeedLimit ||
      next.storageVerbosity !== current.storageVerbosity

    if (needsRestart) {
      await this.restartForSettings(next, current, signal)
      return
    }

    const seedingChanged = next.seedingEnabled !== current.seedingEnabled
    try {
      if (seedingChanged) await this.applySeeding(next.seedingEnabled, next.downloadPath)
      if (next.pollingInterval !== current.pollingInterval) this.startPolling(next.pollingInterval)
      this.appliedSettings = next
    } catch (error) {
      if (!seedingChanged) throw error
      try {
        await this.applySeeding(current.seedingEnabled, current.downloadPath)
      } catch (rollbackError) {
        this.appliedSettings = null
        throw new AggregateError([error, rollbackError], 'Storage seeding apply and rollback failed')
      }
      throw error
    }
  }

  private async restartForSettings(
    next: StorageRuntimeSettings,
    previous: StorageRuntimeSettings | null,
    signal: AbortSignal
  ): Promise<void> {
    await this.teardown()
    if (signal.aborted || !this.desiredRunning) throw new Error('Storage settings apply aborted')

    try {
      await this.startOnce(signal, next)
    } catch (error) {
      if (!signal.aborted && this.desiredRunning && previous) {
        try {
          await this.teardown()
          await this.startOnce(signal, previous)
        } catch (rollbackError) {
          this.appliedSettings = null
          throw new AggregateError([error, rollbackError], 'Storage settings apply and rollback failed')
        }
      }
      throw error
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      storagePath: this.storagePath,
    }
  }

  isActive(): boolean {
    return (
      this.desiredRunning ||
      this.isRunning ||
      this.supervisor.isRunning ||
      this.client !== null ||
      this.startFlight !== null ||
      this.stopFlight !== null ||
      this.settingsAbortControllers.size > 0
    )
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

    const seedingEnabled = this.appliedSettings?.seedingEnabled ?? getSetting('storage').seedingEnabled
    const bags = await this.client.listBags()
    return bags.map((b) => this.mapBagInfo(b, seedingEnabled))
  }

  async resumeSeeding(): Promise<void> {
    await this.applySeeding(true)
  }

  private async applySeeding(enabled: boolean, downloadPath = this.storagePath): Promise<void> {
    const client = this.client
    if (!client || !this.supervisor.isRunning) return
    try {
      const bags = await client.listBags()
      for (const bag of bags) {
        if (enabled && bag.completed && !bag.active) {
          log.debug(`Seeding enabled: resuming bag ${bag.bag_id.slice(0, 8)}...`)
          await client.addBag({
            bag_id: bag.bag_id,
            path: downloadPath,
            download_all: true,
          })
        } else if (!enabled && bag.completed && bag.active) {
          log.debug(`Seeding disabled: stopping bag ${bag.bag_id.slice(0, 8)}...`)
          await client.stopBag(bag.bag_id)
        }
      }
    } catch (err) {
      log.error(`Apply seeding setting error: ${String(err)}`)
      throw err
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
