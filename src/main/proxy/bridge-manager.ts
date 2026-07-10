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
import { EventEmitter } from 'events'
import path from 'path'
import { mkdir } from 'fs/promises'
import { app } from 'electron'
import { getBinaryPath } from '../utils/paths'
import { stripAnsi } from '../utils/strip-ansi'
import { createLogger } from '../../shared/logger'
import { applyBridgeDefaults } from './config-writer'
import { getSetting } from '../settings'
import { NativeProcessSupervisor } from '../native-process/supervisor'

const log = createLogger('proxy')

export class BridgeManager extends EventEmitter {
  private readonly supervisor = new NativeProcessSupervisor()

  isRunning(): boolean {
    return this.supervisor.isRunning
  }

  private async getWorkDir(): Promise<string> {
    const dir = path.join(app.getPath('userData'), 'bridge')
    await mkdir(dir, { recursive: true })
    return dir
  }

  async start(wsPort: number): Promise<void> {
    const bridgeBinPath = getBinaryPath('tonutils-bridge')
    const bridgeWorkDir = await this.getWorkDir()
    await applyBridgeDefaults(bridgeWorkDir, { enableChatNamespaces: getSetting('messenger').networkEnabled })
    const bridgeArgs = ['-addr', `127.0.0.1:${wsPort}`, '-data-dir', bridgeWorkDir, '-verbosity', '2']

    log.info(`Starting bridge from: ${bridgeBinPath}`)
    log.info(`Bridge WS port: ${wsPort}`)

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

    this.supervisor.start({
      name: 'tonutils-bridge',
      command: bridgeBinPath,
      args: bridgeArgs,
      options: { windowsHide: true },
      onStdout: handleBridgeOutput,
      onStderr: handleBridgeOutput,
      onExit: (code) => {
        log.info(`Bridge exited with code: ${code}`)
        this.emit('exit', code)
      },
      onError: (error) => {
        log.error(`Failed to start bridge:`, error)
        this.emit('error', error.message)
      },
    })
  }

  async stop(): Promise<void> {
    await this.supervisor.stop()
  }
}
