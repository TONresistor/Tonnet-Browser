/**
 * CocoonManager.
 * Spawns and manages cocoon-runner.
 * Renders client-config.json from a template into a tmpfs dir, copies the
 * TON config, applies the TDX-skip env vars, and exposes a state EventEmitter.
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { createLogger } from '../../shared/logger'
import { getCocoonBinaryPath, getTonConfigPath, getClientConfigTemplatePath } from './paths'
import { checkCocoonAvailability } from './platform'

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
  private runnerProcess: ChildProcess | null = null
  private state: CocoonState = { kind: 'stopped' }
  private runDir: string | null = null
  private httpPort: number = 10000
  private killTimer: ReturnType<typeof setTimeout> | null = null
  private stopping = false

  getState(): CocoonState {
    return this.state
  }

  getHttpPort(): number {
    return this.httpPort
  }

  async start(config: CocoonConfig): Promise<void> {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
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

    this.runDir = this.createRunDir()
    log.info(`Cocoon runDir: ${this.runDir}`)

    this.renderClientConfig({ ...config, httpPort: this.httpPort, rpcPort })
    this.copyTonConfig()

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
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }

    const runner = this.runnerProcess

    for (const proc of [runner]) {
      if (proc) {
        try {
          proc.kill('SIGTERM')
        } catch {
          /* already dead */
        }
      }
    }

    // Force-kill grace period — closure references captured LOCAL refs, not this.X
    this.killTimer = setTimeout(() => {
      this.killTimer = null
      for (const proc of [runner]) {
        if (proc) {
          try {
            proc.kill('SIGKILL')
          } catch {
            /* already dead */
          }
        }
      }
    }, 3000)

    // Wait for both processes to exit before touching the run dir
    await Promise.all(
      [runner]
        .filter((p): p is ChildProcess => p !== null)
        .map((proc) => Promise.race([new Promise<void>((r) => proc.once('exit', () => r())), this.delay(3000)]))
    )

    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }

    for (const proc of [runner]) {
      if (proc) {
        proc.stdout?.removeAllListeners()
        proc.stderr?.removeAllListeners()
        proc.removeAllListeners()
      }
    }

    this.runnerProcess = null
    this.cleanupRunDir()
    this.transition({ kind: 'stopped' })
    this.stopping = false
  }

  private createRunDir(): string {
    const oldUmask = process.umask(0o077)
    try {
      return mkdtempSync(resolve(tmpdir(), 'cocoon-'))
    } finally {
      process.umask(oldUmask)
    }
  }

  private cleanupRunDir(): void {
    if (this.runDir && existsSync(this.runDir)) {
      try {
        rmSync(this.runDir, { recursive: true, force: true })
      } catch (err) {
        log.warn(`Failed to clean runDir ${this.runDir}: ${err}`)
      }
    }
    this.runDir = null
  }

  private renderClientConfig(vars: CocoonConfig & { httpPort: number; rpcPort: number }): void {
    if (!this.runDir) throw new Error('runDir not initialized')

    const template = readFileSync(getClientConfigTemplatePath(), 'utf-8')

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
    writeFileSync(configPath, rendered, { mode: 0o600 })
  }

  private copyTonConfig(): void {
    if (!this.runDir) throw new Error('runDir not initialized')
    copyFileSync(getTonConfigPath(), resolve(this.runDir, 'global.config.json'))
  }

  private spawnRunner(): void {
    if (!this.runDir) throw new Error('runDir not initialized')
    const binPath = getCocoonBinaryPath('runner')
    const configPath = resolve(this.runDir, 'client-config.json')
    // -v3: debug verbosity. Surfaces ADNL handshake details, liteserver picks,
    // and tonlib sync progress — required to diagnose sync failures upstream.
    const args = ['--config', configPath, '-v3']

    log.info(`Spawning cocoon-runner: ${binPath} ${args.join(' ')}`)

    this.runnerProcess = spawn(binPath, args, {
      windowsHide: true,
      env: {
        ...process.env,
        COCOON_ROUTER_POLICY: 'any',
        COCOON_SKIP_TDX_USERCLAIMS: '1',
        COCOON_SKIP_PROXY_HASH: '1',
      },
    })

    this.attachOutputHandlers(this.runnerProcess, 'runner')

    this.runnerProcess.on('exit', (code) => {
      log.info(`cocoon-runner exited (code=${code})`)
      this.runnerProcess = null
      if (this.stopping) return
      if (this.state.kind !== 'stopped' && this.state.kind !== 'crashed') {
        this.transition({ kind: 'crashed', error: `runner exited (code=${code})` })
      }
    })
  }

  private attachOutputHandlers(proc: ChildProcess, source: 'runner'): void {
    const handler = (data: Buffer) => {
      const raw = data.toString().trim()
      if (!raw) return
      log.debug(`[${source}] ${raw}`)
      this.emit('log', { source, line: raw })
    }
    proc.stdout?.on('data', handler)
    proc.stderr?.on('data', handler)
    proc.on('error', (err) => {
      log.error(`[${source}] spawn error:`, err)
      this.emit('log', { source, line: `spawn error: ${err.message}` })
    })
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + READINESS_TIMEOUT_MS
    const url = `http://127.0.0.1:${this.httpPort}/jsonstats`

    this.transition({ kind: 'starting', phase: 'sync' })

    while (Date.now() < deadline) {
      if (!this.runnerProcess) {
        throw new Error('child process exited during startup')
      }

      try {
        const res = await fetchWithTimeout(url, READINESS_POLL_MS)
        if (res?.ok) {
          const data = await res.json()
          if (this.state.kind === 'starting' && this.state.phase === 'sync') {
            this.transition({ kind: 'starting', phase: 'staking' })
          }
          if (isFullyReady(data)) {
            return
          }
        }
      } catch {
        /* runner not yet listening */
      }

      await this.delay(READINESS_POLL_MS)
    }

    throw new Error(`Cocoon not ready after ${READINESS_TIMEOUT_MS / 1000}s`)
  }

  private transition(next: CocoonState): void {
    const prev = this.state
    if (statesEqual(prev, next)) return
    this.state = next
    log.info(`state: ${describeState(prev)} -> ${describeState(next)}`)
    this.emit('state-change', next, prev)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
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
