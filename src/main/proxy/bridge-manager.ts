/**
 * WS-ADNL bridge process lifecycle (OPP-36).
 *
 * Split out of ProxyManager: the bridge is conceptually a distinct service from
 * the HTTP proxy. BridgeManager owns only the bridge process and emits events;
 * ProxyManager orchestrates (starts it after the proxy is ready) and decides
 * session-wide status. REQUIRED_NAMESPACES re-enforcement stays in
 * applyBridgeDefaults (config-writer), called on every start here.
 *
 * Events: 'ready'(wsPort) | 'log'(line) | 'exit'(code) | 'error'(message).
 */
import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { getBinaryPath } from '../utils/paths'
import { stripAnsi } from '../utils/strip-ansi'
import { createLogger } from '../../shared/logger'
import { applyBridgeDefaults } from './config-writer'
import { killChildProcess } from './process-utils'

const log = createLogger('proxy')

export class BridgeManager extends EventEmitter {
  private process: ChildProcess | null = null

  isRunning(): boolean {
    return this.process !== null
  }

  private getWorkDir(): string {
    const dir = path.join(app.getPath('userData'), 'bridge')
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  async start(wsPort: number): Promise<void> {
    const bridgeBinPath = getBinaryPath('tonutils-bridge')
    const bridgeWorkDir = this.getWorkDir()
    applyBridgeDefaults(bridgeWorkDir)
    const bridgeArgs = ['-addr', `127.0.0.1:${wsPort}`, '-data-dir', bridgeWorkDir, '-verbosity', '2']

    log.info(`Starting bridge from: ${bridgeBinPath}`)
    log.info(`Bridge WS port: ${wsPort}`)

    this.process = spawn(bridgeBinPath, bridgeArgs, {
      windowsHide: true,
    })

    const handleBridgeOutput = (data: Buffer) => {
      const raw = data.toString().trim()
      if (!raw) return
      const message = stripAnsi(raw)
      log.debug(`[bridge] ${raw}`)
      this.emit('log', `[bridge] ${raw}`)

      if (message.toLowerCase().includes('websocket-adnl bridge started')) {
        log.info(`WS bridge ready on port ${wsPort}`)
        this.emit('ready', wsPort)
      }
    }

    this.process.stdout?.on('data', handleBridgeOutput)
    this.process.stderr?.on('data', handleBridgeOutput)

    this.process.on('exit', (code) => {
      log.info(`Bridge exited with code: ${code}`)
      this.process = null
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      log.error(`Failed to start bridge:`, err)
      this.emit('error', err.message)
    })
  }

  async stop(): Promise<void> {
    if (!this.process) return
    const proc = this.process
    this.process = null
    await killChildProcess(proc)
  }
}
