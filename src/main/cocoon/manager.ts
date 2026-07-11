/**
 * CocoonManager.
 * Spawns and manages cocoon-runner.
 * Renders client-config.json from a template into a tmpfs dir, copies the
 * TON config, applies the TDX-skip env vars, and exposes a state EventEmitter.
 */

import { EventEmitter } from 'events'
import { chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { createLogger, diagnosticLoggingStatus } from '../../shared/logger'
import { getCocoonBinaryPath, getTonConfigPath, getClientConfigTemplatePath } from './paths'
import { checkCocoonAvailability } from './platform'
import { NativeProcessSupervisor } from '../native-process/supervisor'

const log = createLogger('cocoon:manager')

// Startup is two-phase in practice: first run often sends register/top-up txs
// and then waits for the runner to notice the new on-chain state; a fresh
// process started shortly after usually attaches immediately. Keep each
// attempt short and let lifecycle.ts perform one automatic retry.
const READINESS_TIMEOUT_MS = 180_000
const READINESS_POLL_MS = 3_000

export type CocoonPhase = 'client-runner' | 'sync' | 'staking'

export type CocoonState =
  | { kind: 'stopped' }
  | { kind: 'starting'; phase: CocoonPhase }
  | { kind: 'ready'; httpPort: number }
  | { kind: 'crashed'; error: string }

export interface CocoonConfig {
  /** TON address of the user's owner wallet (W4R2). */
  ownerAddress: string
  /** Base64-encoded 32-byte Ed25519 secret of the cocoon wallet. */
  nodeWalletKeyBase64: string
  /** Mainnet root contract address. */
  rootContractAddress: string
  /** Instance number for port offset (0 = port 10000, 1 = 10010, …). */
  instance?: number
  /** Optional Toncenter API key to relax rate limits. */
  toncenterApiKey?: string
}

export class CocoonManager extends EventEmitter {
  private readonly supervisor = new NativeProcessSupervisor()
  private state: CocoonState = { kind: 'stopped' }
  private runDir: string | null = null
  private httpPort: number = 10000
  private stopping = false

  getState(): CocoonState {
    return this.state
  }

  getHttpPort(): number {
    return this.httpPort
  }

  async start(config: CocoonConfig): Promise<void> {
    if (this.state.kind !== 'stopped') {
      throw new Error(`Cocoon already running (state=${this.state.kind})`)
    }

    const availability = checkCocoonAvailability()
    if (!availability.available) {
      throw new Error(availability.message)
    }

    const instance = config.instance ?? 0
    this.httpPort = 10000 + instance * 10
    const rpcPort = 10001 + instance * 10

    this.runDir = await this.createRunDir()
    log.debug(`Cocoon runDir: ${this.runDir}`)

    await Promise.all([this.renderClientConfig({ ...config, httpPort: this.httpPort, rpcPort }), this.copyTonConfig()])

    try {
      this.transition({ kind: 'starting', phase: 'client-runner' })
      this.spawnRunner()

      await this.waitForReady()
      this.transition({ kind: 'ready', httpPort: this.httpPort })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Cocoon start failed: ${msg}`)
      this.transition({ kind: 'crashed', error: msg })
      await this.stop()
      throw err
    }
  }

  async stop(): Promise<void> {
    this.stopping = true
    try {
      await this.supervisor.stop()
      await this.cleanupRunDir()
      this.transition({ kind: 'stopped' })
    } finally {
      this.stopping = false
    }
  }

  private async createRunDir(): Promise<string> {
    const directory = await mkdtemp(resolve(tmpdir(), 'cocoon-'))
    await chmod(directory, 0o700)
    return directory
  }

  private async cleanupRunDir(): Promise<void> {
    if (this.runDir) {
      try {
        await rm(this.runDir, { recursive: true, force: true })
      } catch (err) {
        log.warn(`Failed to clean runDir ${this.runDir}: ${err}`)
      }
    }
    this.runDir = null
  }

  private async renderClientConfig(vars: CocoonConfig & { httpPort: number; rpcPort: number }): Promise<void> {
    if (!this.runDir) throw new Error('runDir not initialized')

    const template = await readFile(getClientConfigTemplatePath(), 'utf-8')

    const replacements: Record<string, string | number | boolean> = {
      IS_DEBUG: 0,
      CLIENT_HTTP_PORT: vars.httpPort,
      CLIENT_RPC_PORT: vars.rpcPort,
      OWNER_ADDRESS: vars.ownerAddress,
      ROOT_CONTRACT_ADDRESS: vars.rootContractAddress,
      NODE_WALLET_KEY: vars.nodeWalletKeyBase64,
      TON_CONFIG_FILE: resolve(this.runDir, 'global.config.json'),
    }

    let rendered = template
    for (const [key, value] of Object.entries(replacements)) {
      const quoted = `"$${key}"`
      const unquoted = `$${key}`
      // Replace quoted form (e.g. "$IS_DEBUG") with JSON-typed value
      rendered = rendered.split(quoted).join(JSON.stringify(value))
      // Then any remaining bare placeholder
      rendered = rendered.split(unquoted).join(String(value))
    }

    const configPath = resolve(this.runDir, 'client-config.json')
    await writeFile(configPath, rendered, { mode: 0o600 })
  }

  private async copyTonConfig(): Promise<void> {
    if (!this.runDir) throw new Error('runDir not initialized')
    await copyFile(getTonConfigPath(), resolve(this.runDir, 'global.config.json'))
  }

  private spawnRunner(): void {
    if (!this.runDir) throw new Error('runDir not initialized')
    const binPath = getCocoonBinaryPath('runner')
    const configPath = resolve(this.runDir, 'client-config.json')
    const args = ['--config', configPath, `-v${diagnosticLoggingStatus().enabled ? 3 : 1}`]

    log.debug(`Spawning cocoon-runner: ${binPath} ${args.join(' ')}`)

    this.supervisor.start({
      name: 'cocoon-runner',
      command: binPath,
      args,
      options: {
        windowsHide: true,
        env: {
          ...process.env,
          COCOON_ROUTER_POLICY: 'any',
          COCOON_SKIP_TDX_USERCLAIMS: '1',
          COCOON_SKIP_PROXY_HASH: '1',
        },
      },
      onLine: ({ line }) => this.emit('log', { source: 'runner', line }),
      onError: (err) => {
        log.error('[runner] spawn error:', err)
        this.emit('log', { source: 'runner', line: `spawn error: ${err.message}` })
      },
      onExit: (code) => {
        log.info(`cocoon-runner exited (code=${code})`)
        if (this.stopping) return
        if (this.state.kind !== 'stopped' && this.state.kind !== 'crashed') {
          this.transition({ kind: 'crashed', error: `runner exited (code=${code})` })
        }
      },
    })
  }

  private async waitForReady(): Promise<void> {
    const url = `http://127.0.0.1:${this.httpPort}/jsonstats`

    this.transition({ kind: 'starting', phase: 'sync' })
    await this.supervisor.waitForReady({
      timeoutMs: READINESS_TIMEOUT_MS,
      intervalMs: READINESS_POLL_MS,
      probe: async () => {
        try {
          const res = await fetchWithTimeout(url, READINESS_POLL_MS)
          if (!res?.ok) return false
          const data = await res.json()
          if (this.state.kind === 'starting' && this.state.phase === 'sync') {
            this.transition({ kind: 'starting', phase: 'staking' })
          }
          return isFullyReady(data)
        } catch {
          return false
        }
      },
    })
  }

  private transition(next: CocoonState): void {
    const prev = this.state
    if (statesEqual(prev, next)) return
    this.state = next
    log.event('debug', 'cocoon.state.changed', `state ${describeState(prev)} → ${describeState(next)}`, {
      previous: describeState(prev),
      next: describeState(next),
    })
    if (next.kind === 'ready') {
      log.status('cocoon.ready', 'cocoon ready', { port: next.httpPort })
    }
    this.emit('state-change', next, prev)
  }
}

function statesEqual(a: CocoonState, b: CocoonState): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'starting' && b.kind === 'starting') return a.phase === b.phase
  if (a.kind === 'ready' && b.kind === 'ready') return a.httpPort === b.httpPort
  if (a.kind === 'crashed' && b.kind === 'crashed') return a.error === b.error
  return true
}

function describeState(s: CocoonState): string {
  switch (s.kind) {
    case 'stopped':
      return 'stopped'
    case 'starting':
      return `starting:${s.phase}`
    case 'ready':
      return `ready:${s.httpPort}`
    case 'crashed':
      return `crashed:${s.error}`
  }
}

function isFullyReady(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  const proxyConns = obj.proxy_connections as Array<Record<string, unknown>> | undefined
  const proxies = obj.proxies as Array<Record<string, unknown>> | undefined
  // is_ready: handshake completed successfully with the worker.
  // proxies[0].state === 0: on-chain client SC is in normal/active state
  // (not closing/closed). tokens_payed is a usage counter — irrelevant for
  // readiness; a freshly-staked client has tokens_payed=0 and is operational.
  const isReady = proxyConns?.[0]?.is_ready === true
  const state = proxies?.[0]?.state
  const stakeActive = state === 0
  return isReady && stakeActive
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
