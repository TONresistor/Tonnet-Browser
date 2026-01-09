/**
 * TON proxy manager.
 * Spawns and manages the tonnet-proxy process.
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import http from 'http'
import { getBinaryPath } from '../utils/paths'
import { validatePort } from '../utils/validators'
import { getSetting } from '../settings'

export type ProxyStatus = 'stopped' | 'starting' | 'syncing' | 'connected'

export class ProxyManager extends EventEmitter {
  private process: ChildProcess | null = null
  private port: number = 0
  private status: ProxyStatus = 'stopped'
  private syncCheckInterval: NodeJS.Timeout | null = null
  private anonymousMode: boolean = false
  private circuitRotation: boolean = true
  private rotateInterval: string = '10m'
  private circuitRelays: string[] = [] // [entry, middle, exit]

  constructor() {
    super()
  }

  private loadSettings() {
    const network = getSetting('network')
    const advanced = getSetting('advanced')
    this.port = network.proxyPort
    return { network, advanced } // advanced still needed for syncTestDomain
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Proxy already running')
    }

    const { network } = this.loadSettings()

    // Security: Validate spawn arguments
    const safePort = validatePort(this.port)
    this.port = safePort
    this.anonymousMode = network.anonymousMode
    this.circuitRotation = network.circuitRotation
    this.rotateInterval = network.rotateInterval

    this.setStatus('starting')

    if (this.anonymousMode) {
      // Anonymous mode: 3-hop garlic circuit via tonnet-proxy
      const binPath = getBinaryPath('tonnet-proxy')
      console.log(`[ProxyManager] Starting anonymous proxy from: ${binPath}`)
      console.log(`[ProxyManager] Port: ${safePort}, Mode: 3-hop circuit`)

      const args = ['--auto', '--listen', `127.0.0.1:${safePort}`]

      // Add circuit rotation if enabled
      if (network.circuitRotation && network.rotateInterval) {
        args.push(`--rotate=${network.rotateInterval}`)
        console.log(`[ProxyManager] Circuit rotation: ${network.rotateInterval}`)
      }

      this.process = spawn(binPath, args)
    } else {
      // Direct mode: tonnet-proxy with --direct (faster, no anonymity)
      const binPath = getBinaryPath('tonnet-proxy')
      console.log(`[ProxyManager] Starting direct proxy from: ${binPath}`)
      console.log(`[ProxyManager] Port: ${safePort}, Mode: direct`)

      this.process = spawn(binPath, [
        '--direct',
        '--listen', `127.0.0.1:${safePort}`,
      ])
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      console.log(`[proxy] ${message}`)
      this.emit('log', message)

      // Parse circuit relay names from tonnet-proxy output
      if (this.anonymousMode) {
        const entryMatch = message.match(/Entry:\s+(\w+)/)
        const middleMatch = message.match(/Middle:\s+(\w+)/)
        const exitMatch = message.match(/Exit:\s+(\w+)/)
        if (entryMatch) this.circuitRelays[0] = entryMatch[1]
        if (middleMatch) this.circuitRelays[1] = middleMatch[1]
        if (exitMatch) this.circuitRelays[2] = exitMatch[1]
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      if (message) {
        console.log(`[proxy] ${message}`)
        this.emit('error', message)
      }
    })

    this.process.on('exit', (code) => {
      console.log(`[ProxyManager] Proxy exited with code: ${code}`)
      this.setStatus('stopped')
      this.process = null
      if (this.syncCheckInterval) {
        clearInterval(this.syncCheckInterval)
        this.syncCheckInterval = null
      }
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      console.error(`[ProxyManager] Failed to start proxy:`, err)
      this.emit('error', err.message)
    })

    await this.waitForReady()
    this.setStatus('syncing')
    this.startSyncCheck()
  }

  private setStatus(status: ProxyStatus): void {
    this.status = status
    this.emit('status', status)
    console.log(`[ProxyManager] Status: ${status}`)
  }

  private startSyncCheck(): void {
    const { network, advanced } = this.loadSettings()
    const testDomain = advanced.syncTestDomain
    const interval = network.syncCheckInterval

    const checkSync = (): Promise<boolean> => {
      return new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: this.port,
          path: '/',
          method: 'GET',
          headers: { 'Host': testDomain },
          timeout: 5000,
        }, (res) => {
          // If we get a response that's not 502, we're synced
          if (res.statusCode !== 502) {
            console.log(`[ProxyManager] Sync complete! ${testDomain} responded with ${res.statusCode}`)
            resolve(true)
          } else {
            resolve(false)
          }
          res.resume()
        })

        req.on('error', () => resolve(false))
        req.on('timeout', () => {
          req.destroy()
          resolve(false)
        })
        req.end()
      })
    }

    this.syncCheckInterval = setInterval(async () => {
      if (await checkSync()) {
        this.setStatus('connected')
        if (this.syncCheckInterval) {
          clearInterval(this.syncCheckInterval)
          this.syncCheckInterval = null
          console.log('[ProxyManager] Sync check stopped')
        }
      }
    }, interval)
  }

  stop(): void {
    if (this.syncCheckInterval) {
      clearInterval(this.syncCheckInterval)
      this.syncCheckInterval = null
    }
    if (this.process) {
      console.log('[ProxyManager] Stopping proxy...')
      // Clean up all listeners before killing to prevent memory leaks
      this.process.stdout?.removeAllListeners()
      this.process.stderr?.removeAllListeners()
      this.process.removeAllListeners()
      this.process.kill('SIGTERM')
      this.process = null
      this.circuitRelays = []
      this.setStatus('stopped')
      this.emit('disconnected')
    }
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      syncing: this.status === 'syncing',
      port: this.port,
      anonymousMode: this.anonymousMode,
      circuitRelays: this.circuitRelays,
    }
  }

  isRunning(): boolean {
    return this.process !== null
  }

  isSynced(): boolean {
    return this.status === 'connected'
  }

  getProxyUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  // Restart proxy if anonymousMode changed
  async restart(): Promise<void> {
    console.log('[ProxyManager] Restarting proxy...')
    this.stop()
    // Wait a bit for the process to fully stop
    await new Promise((r) => setTimeout(r, 500))
    await this.start()
  }

  // Check if network settings changed and restart if needed
  async applySettingsChange(): Promise<void> {
    const { network } = this.loadSettings()
    const needsRestart =
      network.anonymousMode !== this.anonymousMode ||
      (this.anonymousMode && (
        network.circuitRotation !== this.circuitRotation ||
        network.rotateInterval !== this.rotateInterval
      ))

    if (needsRestart) {
      console.log(`[ProxyManager] Network settings changed, restarting proxy...`)
      await this.restart()
    }
  }

  private async waitForReady(): Promise<void> {
    const { network } = this.loadSettings()
    const maxAttempts = network.connectionTimeout // seconds

    // Both modes now use tonnet-proxy which outputs "Proxy listening" when ready
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Proxy failed to start within timeout'))
      }, maxAttempts * 1000)

      const checkOutput = (data: Buffer) => {
        if (data.toString().includes('Proxy listening')) {
          clearTimeout(timeout)
          this.process?.stdout?.off('data', checkOutput)
          console.log('[ProxyManager] Proxy is ready')
          resolve()
        }
      }
      this.process?.stdout?.on('data', checkOutput)
    })
  }
}

// Singleton instance
export const proxyManager = new ProxyManager()
