/**
 * TON proxy manager.
 * Spawns and manages the tonutils-proxy process (Tonutils-Proxy CLI).
 * Uses adnl-tunnel for multi-hop garlic routing via TON DHT discovery.
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { getBinaryPath } from '../utils/paths'
import { validatePort } from '../utils/validators'
import { stripAnsi } from '../utils/strip-ansi'
import { getSetting } from '../settings'
import { DEFAULT_SETTINGS } from '../../shared/defaults'
import { GeneralSettings } from '../../shared/schemas'
import { createLogger } from '../../shared/logger'
import { TUNNEL_SECTIONS } from '../../shared/constants'
import { writeProxyConfig } from './config-writer'
import { BridgeManager } from './bridge-manager'
import { killChildProcess } from './process-utils'
import { trackDaemon } from '../daemon-registry'
const log = createLogger('proxy')

/**
 * Build CLI args for the tonutils-proxy binary.
 * Exported for unit testing.
 */
export function buildProxyArgs(port: number, general: GeneralSettings): string[] {
  const args: string[] = ['-addr', `127.0.0.1:${port}`]
  if (general.resolveEth === false) {
    args.push('-no-eth')
  } else if (general.resolveEth === true && general.ethRpc.trim() !== '') {
    args.push('-eth-rpc', general.ethRpc.trim())
  }
  if (general.resolveSol === false) {
    args.push('-no-sol')
  } else if (general.resolveSol === true && general.solRpc.trim() !== '') {
    args.push('-sol-rpc', general.solRpc.trim())
  }
  return args
}

export type ProxyStatus = 'stopped' | 'starting' | 'syncing' | 'connected'

export class ProxyManager extends EventEmitter {
  private process: ChildProcess | null = null
  private readonly bridge = new BridgeManager()
  private port: number = 0
  private wsPort: number = DEFAULT_SETTINGS.wsPort
  private status: ProxyStatus = 'stopped'
  private anonymousMode: boolean = false
  private tunnelMode: 'standard' | 'maximum' = DEFAULT_SETTINGS.tunnelMode
  private tunnelRoute: string = ''
  private resolveEth: boolean = DEFAULT_SETTINGS.resolveEth
  private ethRpc: string = DEFAULT_SETTINGS.ethRpc
  private resolveSol: boolean = DEFAULT_SETTINGS.resolveSol
  private solRpc: string = DEFAULT_SETTINGS.solRpc

  constructor() {
    super()
    // The bridge is a distinct process; forward its events. A bridge-only crash
    // must not mislabel a still-working proxy as stopped, so the session-wide
    // 'exit' only fires here when the proxy is already gone.
    this.bridge.on('ready', (wsPort: number) => this.emit('ws-bridge-ready', wsPort))
    this.bridge.on('log', (line: string) => this.emit('log', line))
    this.bridge.on('error', (message: string) => this.emit('error', message))
    this.bridge.on('exit', (code: number | null) => {
      this.emit('bridge-exit', code)
      if (!this.process) {
        this.setStatus('stopped')
        this.emit('exit', code)
      }
    })
  }

  private loadSettings() {
    const network = getSetting('network')
    const advanced = getSetting('advanced')
    const general = getSetting('general')
    this.port = network.proxyPort
    this.wsPort = validatePort(network.wsPort, DEFAULT_SETTINGS.wsPort)
    return { network, advanced, general }
  }

  private static MAX_START_RETRIES = 3
  private static RETRY_DELAY_MS = 2000

  async start(): Promise<void> {
    for (let attempt = 1; attempt <= ProxyManager.MAX_START_RETRIES; attempt++) {
      try {
        await this.startOnce()
        return
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (attempt < ProxyManager.MAX_START_RETRIES && message.includes('exited before ready')) {
          log.warn(`Proxy start failed (attempt ${attempt}/${ProxyManager.MAX_START_RETRIES}): ${message}`)
          await this.stopRunningProcesses()
          log.info(`Retrying in ${ProxyManager.RETRY_DELAY_MS}ms...`)
          await new Promise((r) => setTimeout(r, ProxyManager.RETRY_DELAY_MS))
        } else {
          throw err
        }
      }
    }
  }

  private async startOnce(): Promise<void> {
    if (this.process) {
      throw new Error('Proxy already running')
    }

    const { network, general } = this.loadSettings()

    const safePort = validatePort(this.port)
    this.port = safePort
    this.anonymousMode = network.anonymousMode
    this.tunnelMode = network.tunnelMode
    this.resolveEth = general.resolveEth
    this.ethRpc = general.ethRpc
    this.resolveSol = general.resolveSol
    this.solRpc = general.solRpc
    this.setStatus('starting')

    const proxyBinPath = getBinaryPath('tonutils-proxy')
    const proxyWorkDir = this.getProxyWorkDir()

    // Write proxy config to control tunnel mode
    const tunnelSections = this.anonymousMode ? TUNNEL_SECTIONS[this.tunnelMode] : 0
    writeProxyConfig(proxyWorkDir, tunnelSections)

    // Spawn proxy process (HTTP proxy for .ton sites)
    if (this.anonymousMode) {
      log.info(`Starting anonymous proxy from: ${proxyBinPath}`)
      log.info(`Port: ${safePort}, Mode: tunnel (DHT discovery)`)
      log.info('Tunnel auto-reroute: managed by adnl-tunnel (on stall)')
    } else {
      log.info(`Starting direct proxy from: ${proxyBinPath}`)
      log.info(`Port: ${safePort}, Mode: direct`)
    }

    this.process = spawn(proxyBinPath, buildProxyArgs(safePort, general), {
      windowsHide: true,
      cwd: proxyWorkDir,
    })
    trackDaemon('tonutils-proxy', this.process)

    // Proxy output handler
    const handleProxyOutput = (data: Buffer) => {
      const raw = data.toString().trim()
      if (!raw) return
      // Strip ANSI escape codes for parsing
      const message = stripAnsi(raw)
      log.debug(raw)
      this.emit('log', raw)

      // Transition to syncing once DHT/tunnel work begins
      if (this.status === 'starting') {
        const lower = message.toLowerCase()
        if (
          lower.includes('discovering tunnel relay') ||
          lower.includes('initializing dht') ||
          lower.includes('initializing adnl tunnel') ||
          lower.includes('initializing dns resolver')
        ) {
          this.setStatus('syncing')
        }
      }

      // Parse storage bag discovery from proxy logs
      // Format: searching for bag id bag_id=<hex> host=<domain>
      const bagMatch = message.match(/searching for bag id\s+bag_id=([a-fA-F0-9]{64})\s+host=(\S+)/)
      if (bagMatch) {
        const domain = bagMatch[2]
        // Validate domain format to prevent log injection attacks
        if (/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain)) {
          this.emit('storage-bag-detected', { bagId: bagMatch[1], domain })
        }
      }

      // Parse tunnel route from Tonutils-Proxy logs
      // Raw format: route="we -> KEY1 -> KEY2 -> KEY1 -> we"
      if (this.anonymousMode) {
        const routeMatch = message.match(/route="([^"]+)"/)
        if (routeMatch && routeMatch[1] !== this.tunnelRoute) {
          this.tunnelRoute = routeMatch[1]
          const relays = routeMatch[1].split(' -> ').filter((s) => s !== 'we')
          log.info(`Tunnel route (${relays.length} hops):`)
          relays.forEach((key, i) => log.info(`  ${i + 1} → ${key.slice(0, 16)}`))
        }
      }
    }

    this.process.stdout?.on('data', handleProxyOutput)
    this.process.stderr?.on('data', handleProxyOutput)

    this.process.on('exit', (code) => {
      log.info(`Proxy exited with code: ${code}`)
      this.setStatus('stopped')
      this.process = null
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      log.error(`Failed to start proxy:`, err)
      // ENOENT etc. fire 'error' not 'exit', so reset state or isRunning() lies
      // and a retry is blocked as 'already running'.
      this.process = null
      this.setStatus('stopped')
      this.emit('error', err.message)
    })

    await this.waitForReady()
    this.setStatus('connected')

    // Start bridge AFTER proxy is ready to avoid DHT contention
    if (!this.bridge.isRunning()) {
      await this.bridge.start(this.wsPort)
    }
  }

  private async stopRunningProcesses(): Promise<void> {
    const promises: Promise<void>[] = [this.bridge.stop()]
    if (this.process) {
      const proxyProc = this.process
      this.process = null
      promises.push(killChildProcess(proxyProc))
    }
    await Promise.allSettled(promises)
  }

  private getProxyWorkDir(): string {
    const dir = path.join(app.getPath('userData'), 'proxy')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private setStatus(status: ProxyStatus): void {
    this.status = status
    this.emit('status', status)
    log.info(`Status: ${status}`)
  }

  async stop(): Promise<void> {
    if (!this.process && !this.bridge.isRunning()) return

    log.info('Stopping proxy and bridge...')
    this.tunnelRoute = ''

    const promises: Promise<void>[] = [this.bridge.stop()]

    if (this.process) {
      const proxyProc = this.process
      this.process = null
      promises.push(killChildProcess(proxyProc))
    }

    await Promise.allSettled(promises)
    this.setStatus('stopped')
    this.emit('disconnected')
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      port: this.port,
      wsPort: this.wsPort,
      anonymousMode: this.anonymousMode,
      circuitRelays: this.tunnelRoute ? this.tunnelRoute.split(' -> ').filter((s) => s !== 'we') : [],
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.bridge.isRunning()
  }

  isSynced(): boolean {
    return this.status === 'connected'
  }

  getProxyUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async restart(): Promise<void> {
    log.info('Restarting proxy...')
    await this.stop()
    await this.start()
  }

  async restartBridge(): Promise<void> {
    if (!this.process) {
      throw new Error('Cannot restart bridge: proxy is not running')
    }
    log.info('Restarting bridge (keeping proxy)...')
    await this.bridge.stop()
    await this.bridge.start(this.wsPort)
  }

  async applySettingsChange(): Promise<void> {
    const { network, general } = this.loadSettings()
    const needsRestart =
      network.anonymousMode !== this.anonymousMode ||
      network.tunnelMode !== this.tunnelMode ||
      general.resolveEth !== this.resolveEth ||
      general.ethRpc !== this.ethRpc ||
      general.resolveSol !== this.resolveSol ||
      general.solRpc !== this.solRpc

    if (needsRestart) {
      log.info(`Settings changed, restarting proxy...`)
      this.tunnelRoute = ''
      if (this.process) {
        const proxyProc = this.process
        this.process = null
        await killChildProcess(proxyProc)
      }
      this.setStatus('stopped')
      await this.start()
    }
  }

  private async waitForReady(): Promise<void> {
    const { network } = this.loadSettings()
    const baseTimeout = network.connectionTimeout
    const maxAttempts = this.anonymousMode ? baseTimeout * 3 : baseTimeout

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        this.process?.stdout?.off('data', checkOutput)
        this.process?.stderr?.off('data', checkOutput)
        this.process?.off('exit', onExit)
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('Proxy failed to start within timeout'))
      }, maxAttempts * 1000)

      // Fail-fast if process exits before being ready (e.g. DHT discovery failure)
      const onExit = (code: number | null) => {
        cleanup()
        reject(new Error(`Proxy exited before ready (code: ${code})`))
      }
      this.process?.on('exit', onExit)

      const checkOutput = (data: Buffer) => {
        const raw = data.toString()
        const output = stripAnsi(raw).toLowerCase()
        // In direct mode: "starting proxy server" comes immediately
        // In tunnel mode: "starting proxy server" comes AFTER tunnel init (~10-15s)
        // We must wait for the proxy to actually be listening before starting sync checks
        if (
          output.includes('starting proxy server') ||
          output.includes('listening on') ||
          output.includes('proxy listening')
        ) {
          cleanup()
          log.info('Proxy is ready')
          resolve()
        }
      }
      this.process?.stdout?.on('data', checkOutput)
      this.process?.stderr?.on('data', checkOutput)
    })
  }
}

// Singleton removed: use ServiceRegistry from services.ts
