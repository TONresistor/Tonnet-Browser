/**
 * TON Storage daemon manager.
 * Spawns and manages the tonutils-storage process.
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { getBinaryPath, getStoragePath, getConfigPath } from '../utils/paths'
import { validatePort, validateVerbosity } from '../utils/validators'
import { StorageHTTPClient, BagInfo } from './http-client'
import type { StorageBag } from '../../shared/types'
import { getSetting, getDownloadPath } from '../settings'
import fs from 'fs'
import path from 'path'

export class StorageManager extends EventEmitter {
  private process: ChildProcess | null = null
  private port: number = 0
  private storagePath: string
  private dbPath: string
  private isRunning = false
  private client: StorageHTTPClient | null = null
  private pollInterval: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.storagePath = getDownloadPath()
    this.dbPath = path.join(getStoragePath(), 'db') // DB stays in userData
  }

  private loadSettings() {
    const network = getSetting('network')
    const storage = getSetting('storage')
    const advanced = getSetting('advanced')
    this.port = network.storagePort
    this.storagePath = storage.downloadPath
    return { network, storage, advanced }
  }

  setStoragePath(newPath: string): void {
    this.storagePath = newPath
    console.log('[StorageManager] Storage path updated to:', newPath)
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

    console.log(`[StorageManager] Starting tonutils-storage from: ${binPath}`)
    console.log(`[StorageManager] Config: ${configPath}`)
    console.log(`[StorageManager] DB: ${this.dbPath}`)
    console.log(`[StorageManager] API port: ${safePort}`)
    console.log(`[StorageManager] Verbosity: ${safeVerbosity}`)

    // Start tonutils-storage in daemon mode with HTTP API
    this.process = spawn(binPath, [
      '-daemon',
      '-api', `127.0.0.1:${safePort}`,
      '-db', this.dbPath,
      '-network-config', configPath,
      '-verbosity', String(safeVerbosity),
    ])

    this.process.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      if (message) {
        console.log(`[storage] ${message}`)
        this.emit('log', message)
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      if (message) {
        console.log(`[storage] ${message}`)
        this.emit('error', message)
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[StorageManager] Storage daemon exited with code: ${code}`)
      this.isRunning = false
      this.process = null
      this.client = null
      this.stopPolling()
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      console.error(`[StorageManager] Failed to start storage daemon:`, err)
      this.emit('error', err.message)
    })

    // Create HTTP client
    this.client = new StorageHTTPClient('127.0.0.1', this.port)

    // Wait for API to be ready
    await this.waitForReady()

    this.isRunning = true
    this.emit('started')

    // Start polling for updates
    this.startPolling()
  }

  private async waitForReady(maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (!this.client) break
      if (await this.client.ping()) {
        console.log(`[StorageManager] API ready after ${i + 1} attempts`)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Storage daemon API did not become ready')
  }

  private startPolling(): void {
    const { storage } = this.loadSettings()
    const interval = storage.pollingInterval

    this.pollInterval = setInterval(async () => {
      if (!this.client || !this.isRunning) return
      try {
        const bags = await this.client.listBags()
        this.emit('bags-updated', bags.map(this.mapBagInfo))
      } catch (err) {
        console.error('[StorageManager] Poll error:', err)
      }
    }, interval)
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  private mapBagInfo(info: BagInfo): StorageBag {
    let status: StorageBag['status'] = 'downloading'
    if (!info.active) {
      status = 'paused'
    } else if (info.completed && info.seeding) {
      status = 'seeding'
    } else if (info.completed) {
      status = 'seeding'
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
      console.log('[StorageManager] Stopping storage daemon...')
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

  // Bag operations
  async addBag(bagId: string, downloadPath?: string): Promise<StorageBag> {
    if (!this.client) {
      throw new Error('Storage daemon not running')
    }

    await this.client.addBag({
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
    if (!this.client) {
      throw new Error('Storage daemon not running')
    }

    const result = await this.client.removeBag({
      bag_id: bagId,
      with_files: withFiles,
    })
    return result.ok
  }

  async listBags(): Promise<StorageBag[]> {
    if (!this.client) {
      return []
    }

    const bags = await this.client.listBags()
    return bags.map(this.mapBagInfo)
  }

  async pauseBag(bagId: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('Storage daemon not running')
    }

    const result = await this.client.stopBag(bagId)
    return result.ok
  }

  async getBagDetails(bagId: string) {
    if (!this.client) {
      throw new Error('Storage daemon not running')
    }

    return this.client.getBagDetails(bagId)
  }
}

export const storageManager = new StorageManager()
