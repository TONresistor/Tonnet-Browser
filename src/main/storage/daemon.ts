/**
 * TON Storage daemon manager.
 * Spawns and manages the tonutils-storage process.
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'
import { getBinaryPath, getStoragePath, getConfigPath } from '../utils/paths'
import { validatePort, validateVerbosity } from '../utils/validators'
import { StorageHTTPClient, BagInfo } from './http-client'
import type { StorageBag } from '../../shared/types'
import { getSetting, getDownloadPath } from '../settings'
import { PING_RETRY_DELAY_MS, PING_MAX_ATTEMPTS } from './constants'
import { createLogger } from '../../shared/logger'
const log = createLogger('storage')
import fs from 'fs'
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
  private process: ChildProcess | null = null
  private port: number = 0
  private dbPath: string
  private isRunning = false
  private client: StorageHTTPClient | null = null
  private pollInterval: NodeJS.Timeout | null = null
  private lastBagsJson = ''

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

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Storage daemon already running')
    }

    const { advanced } = this.loadSettings()

    // Ensure storage directories exist
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true })
    }
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true })
    }

    const binPath = getBinaryPath('tonutils-storage')
    const configPath = getConfigPath()

    // Security: Validate spawn arguments (storage default port is 5555)
    const safePort = validatePort(this.port, 5555)
    const safeVerbosity = validateVerbosity(advanced.storageVerbosity)
    this.port = safePort

    // Generate ephemeral auth credentials for this session
    const apiLogin = randomBytes(16).toString('hex')
    const apiPassword = randomBytes(32).toString('hex')

    log.info(`Starting tonutils-storage from: ${binPath}`)
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

    // Start tonutils-storage in daemon mode with HTTP API + auth
    this.process = spawn(binPath, args, { windowsHide: true })

    this.process.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      if (message) {
        log.debug(message)
        this.emit('log', message)
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      if (message) {
        log.warn(message)
        this.emit('error', message)
      }
    })

    this.process.on('exit', (code) => {
      log.info(`Storage daemon exited with code: ${code}`)
      this.isRunning = false
      this.process = null
      this.client = null
      this.stopPolling()
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      log.error(`Failed to start storage daemon: ${err.message}`)
      this.emit('error', err.message)
    })

    // Create HTTP client with same auth credentials
    this.client = new StorageHTTPClient('127.0.0.1', this.port, { login: apiLogin, password: apiPassword })

    // Wait for API to be ready
    await this.waitForReady()

    this.isRunning = true
    this.emit('started')

    // Start polling for updates
    this.startPolling()
  }

  private async waitForReady(maxAttempts = PING_MAX_ATTEMPTS): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false

      // Fail-fast if the daemon crashes before becoming ready
      const onExit = (code: number | null) => {
        if (!settled) {
          settled = true
          reject(new Error(`Storage daemon exited before ready (code: ${code})`))
        }
      }
      this.process?.once('exit', onExit)

      const poll = async () => {
        for (let i = 0; i < maxAttempts; i++) {
          if (settled || !this.client) return
          try {
            if (await this.client.ping()) {
              settled = true
              this.process?.off('exit', onExit)
              log.info(`API ready after ${i + 1} attempts`)
              resolve()
              return
            }
          } catch (error) {
            log.debug(`Ping attempt ${i + 1} failed:`, error)
          }
          await new Promise((r) => setTimeout(r, PING_RETRY_DELAY_MS))
        }
        if (!settled) {
          settled = true
          this.process?.off('exit', onExit)
          reject(new Error(`Storage daemon API did not become ready after ${maxAttempts} attempts`))
        }
      }
      poll()
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

        // Auto-stop seeding bags when seeding is disabled
        const { storage: storageSettings } = this.loadSettings()
        if (!storageSettings.seedingEnabled) {
          for (const bag of bags) {
            if (bag.completed && bag.active) {
              log.info(`Seeding disabled: stopping bag ${bag.bag_id.slice(0, 8)}...`)
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
        log.error(`Poll error: ${String(err)}`)
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

  stop(): void {
    this.stopPolling()
    if (this.process) {
      log.info('Stopping storage daemon...')
      // Clean up all listeners before killing to prevent memory leaks
      this.process.stdout?.removeAllListeners()
      this.process.stderr?.removeAllListeners()
      this.process.removeAllListeners()
      this.process.kill('SIGTERM')
      this.process = null
      this.client = null
      this.isRunning = false
      this.emit('stopped')
    }
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
          log.info(`Seeding enabled: resuming bag ${bag.bag_id.slice(0, 8)}...`)
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
