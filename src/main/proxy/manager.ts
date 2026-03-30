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
import { getSetting } from '../settings'
import { randomBytes } from 'crypto'
import { cpus } from 'os'
import { createLogger } from '../../shared/logger'
const log = createLogger('proxy')

export type ProxyStatus = 'stopped' | 'starting' | 'connected'

export class ProxyManager extends EventEmitter {
  private process: ChildProcess | null = null
  private port: number = 0
  private wsPort: number = 8081
  private status: ProxyStatus = 'stopped'
  private anonymousMode: boolean = false
  private tunnelRoute: string = ''

  constructor() {
    super()
  }

  private loadSettings() {
    const network = getSetting('network')
    const advanced = getSetting('advanced')
    this.port = network.proxyPort
    this.wsPort = network.wsPort
    return { network, advanced }
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Proxy already running')
    }

    const { network } = this.loadSettings()

    const safePort = validatePort(this.port)
    this.port = safePort
    this.anonymousMode = network.anonymousMode
    this.setStatus('starting')

    const binPath = getBinaryPath('tonutils-proxy')
    const proxyWorkDir = this.getProxyWorkDir()

    // Write proxy config to control tunnel mode
    this.writeProxyConfig(proxyWorkDir, this.anonymousMode)

    if (this.anonymousMode) {
      // Anonymous mode: multi-hop tunnel via adnl-tunnel (DHT discovery)
      log.info(`Starting anonymous proxy from: ${binPath}`)
      log.info(`Port: ${safePort}, Mode: tunnel (DHT discovery)`)
      this.process = spawn(binPath, ['-addr', `127.0.0.1:${safePort}`, '-ws-addr', `127.0.0.1:${this.wsPort}`], {
        windowsHide: true,
        cwd: proxyWorkDir,
      })

      // adnl-tunnel handles rerouting automatically when tunnel stalls (>45s no response)
      // No need for forced rotation — it would kill the connection for 10-15s during reconfiguration
      log.info('Tunnel auto-reroute: managed by adnl-tunnel (on stall)')
    } else {
      // Direct mode: no tunnel (faster, no anonymity)
      log.info(`Starting direct proxy from: ${binPath}`)
      log.info(`Port: ${safePort}, Mode: direct`)
      this.process = spawn(binPath, ['-addr', `127.0.0.1:${safePort}`, '-ws-addr', `127.0.0.1:${this.wsPort}`], {
        windowsHide: true,
        cwd: proxyWorkDir,
      })
    }

    const handleProxyOutput = (data: Buffer) => {
      const raw = data.toString().trim()
      if (!raw) return
      // Strip ANSI escape codes for parsing
      // eslint-disable-next-line no-control-regex
      const message = raw.replace(/\x1b\[[0-9;]*m/g, '')
      log.debug(raw)
      this.emit('log', raw)

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
      // Format: route="we -> KEY1 -> KEY2 -> KEY1 -> we"
      if (this.anonymousMode) {
        const routeMatch = message.match(/route="([^"]+)"/)
        if (routeMatch) {
          this.tunnelRoute = routeMatch[1]
          log.info(`Tunnel route: ${this.tunnelRoute}`)
        }
      }

      // Detect WS bridge readiness
      // bridge.go: log.Info().Str("addr", addr).Msg("WebSocket-ADNL bridge started")
      if (message.toLowerCase().includes('websocket-adnl bridge started')) {
        log.info(`WS bridge ready on port ${this.wsPort}`)
        this.emit('ws-bridge-ready', this.wsPort)
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
      this.emit('error', err.message)
    })

    await this.waitForReady()
    this.setStatus('connected')
  }

  private getProxyWorkDir(): string {
    const dir = path.join(app.getPath('userData'), 'proxy')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private writeProxyConfig(workDir: string, tunnelEnabled: boolean): void {
    const configPath = path.join(workDir, 'config.json')

    if (fs.existsSync(configPath)) {
      // Patch existing config
      try {
        const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (existing.TunnelConfig) {
          existing.TunnelConfig.NodesPoolConfigPath = ''
          existing.TunnelConfig.TunnelSectionsNum = tunnelEnabled ? 2 : 0
        }
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2))
        log.info(`Proxy config updated: tunnel=${tunnelEnabled}`)
        return
      } catch {
        // Corrupted config — regenerate below
      }
    }

    // First run: generate config with correct tunnel settings immediately
    // This avoids the double-start (direct → restart → tunnel)
    const generateKey = () => Array.from(randomBytes(32))
    const config = {
      Version: 1,
      ADNLKey: generateKey(),
      CustomTunnelNetworkConfigPath: '',
      TunnelConfig: {
        TunnelServerKey: generateKey(),
        TunnelThreads: cpus().length,
        TunnelSectionsNum: tunnelEnabled ? 2 : 0,
        NodesPoolConfigPath: '',
        PaymentsEnabled: false,
        Payments: {
          ADNLServerKey: generateKey(),
          PaymentsNodeKey: generateKey(),
          WalletPrivateKey: generateKey(),
          DBPath: './payments-db/',
          SecureProofPolicy: false,
          ChannelsConfig: {
            SupportedCoins: { Ton: { Enabled: true }, Jettons: {}, ExtraCurrencies: {} },
            BufferTimeToCommit: 10800,
            QuarantineDurationSec: 21600,
            ConditionalCloseDurationSec: 10800,
            MinSafeVirtualChannelTimeoutSec: 300,
          },
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
    log.info(`Proxy config generated: tunnel=${tunnelEnabled}`)
  }

  private setStatus(status: ProxyStatus): void {
    this.status = status
    this.emit('status', status)
    log.info(`Status: ${status}`)
  }

  stop(): void {
    if (this.process) {
      log.info('Stopping proxy...')
      this.process.stdout?.removeAllListeners()
      this.process.stderr?.removeAllListeners()
      this.process.removeAllListeners()
      this.process.kill('SIGTERM')
      this.process = null
      this.tunnelRoute = ''
      this.setStatus('stopped')
      this.emit('disconnected')
    }
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
    return this.process !== null
  }

  isSynced(): boolean {
    return this.status === 'connected'
  }

  getProxyUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  async restart(): Promise<void> {
    log.info('Restarting proxy...')
    this.stop()
    await new Promise((r) => setTimeout(r, 500))
    await this.start()
  }

  async applySettingsChange(): Promise<void> {
    const { network } = this.loadSettings()
    const needsRestart = network.anonymousMode !== this.anonymousMode

    if (needsRestart) {
      log.info(`Network settings changed, restarting proxy...`)
      await this.restart()
    }
  }

  private async waitForReady(): Promise<void> {
    const { network } = this.loadSettings()
    const maxAttempts = network.connectionTimeout

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Proxy failed to start within timeout'))
      }, maxAttempts * 1000)

      const checkOutput = (data: Buffer) => {
        const raw = data.toString()
        // eslint-disable-next-line no-control-regex
        const output = raw.replace(/\x1b\[[0-9;]*m/g, '').toLowerCase()
        // In direct mode: "starting proxy server" comes immediately
        // In tunnel mode: "starting proxy server" comes AFTER tunnel init (~10-15s)
        // We must wait for the proxy to actually be listening before starting sync checks
        if (
          output.includes('starting proxy server') ||
          output.includes('listening on') ||
          output.includes('proxy listening')
        ) {
          clearTimeout(timeout)
          this.process?.stdout?.off('data', checkOutput)
          this.process?.stderr?.off('data', checkOutput)
          log.info('Proxy is ready')
          resolve()
        }
      }
      this.process?.stdout?.on('data', checkOutput)
      this.process?.stderr?.on('data', checkOutput)
    })
  }
}

// Singleton instance
export const proxyManager = new ProxyManager()
