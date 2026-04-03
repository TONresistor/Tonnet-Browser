/**
 * Generic process supervisor with state machine, health probes, and auto-restart.
 * Consumers (ProxyManager, StorageManager) provide a spawn factory and optional probes.
 */

import { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import { createLogger } from '../../shared/logger'
import {
  PROCESS_KILL_TIMEOUT_MS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  MAX_RESTARTS,
  HEALTH_RESET_AFTER_MS,
  HEALTH_PROBE_INTERVAL_MS,
  HEALTH_PROBE_TIMEOUT_MS,
  HEALTH_FAILURE_THRESHOLD,
} from './constants'

const log = createLogger('process:supervisor')

export type ProcessState = 'stopped' | 'starting' | 'running' | 'crashed' | 'backoff' | 'fatal'

export interface SupervisorConfig {
  name: string
  spawn: () => ChildProcess
  readinessProbe?: () => Promise<boolean>
  livenessProbe?: () => Promise<boolean>
  readinessTimeoutMs?: number
  pidFilePath?: string
}

export class ProcessSupervisor extends EventEmitter {
  private state: ProcessState = 'stopped'
  private process: ChildProcess | null = null
  private restartCount = 0
  private isIntentionallyStopped = false

  // Timers
  private backoffTimer: ReturnType<typeof setTimeout> | null = null
  private livenessInterval: ReturnType<typeof setInterval> | null = null
  private healthResetTimer: ReturnType<typeof setTimeout> | null = null
  private readinessTimer: ReturnType<typeof setTimeout> | null = null
  private killTimer: ReturnType<typeof setTimeout> | null = null

  // Liveness tracking
  private consecutiveFailures = 0

  constructor(private readonly config: SupervisorConfig) {
    super()
  }

  getState(): ProcessState {
    return this.state
  }

  getRestartCount(): number {
    return this.restartCount
  }

  async start(): Promise<void> {
    if (this.state === 'fatal') {
      // Reset counters so we can start fresh
      this.restartCount = 0
      this.transition('stopped')
    }

    if (this.state !== 'stopped') {
      log.warn(`[${this.config.name}] start() called in state ${this.state}, ignoring`)
      return
    }

    this.isIntentionallyStopped = false
    await this.doStart()
  }

  async stop(): Promise<void> {
    this.isIntentionallyStopped = true
    this.clearAllTimers()

    if (this.process) {
      await this.killProcess()
    }

    this.cleanPidFile()
    this.transition('stopped')
  }

  destroy(): void {
    this.isIntentionallyStopped = true
    this.clearAllTimers()

    if (this.process) {
      try {
        this.process.kill('SIGKILL')
      } catch {
        // Process may already be dead
      }
      this.process = null
    }

    this.cleanPidFile()
    this.state = 'stopped'
    this.removeAllListeners()
  }

  // --- Internal state machine ---

  private transition(newState: ProcessState): void {
    const oldState = this.state
    if (oldState === newState) return
    this.state = newState
    log.info(`[${this.config.name}] ${oldState} -> ${newState}`)
    this.emit('state-change', oldState, newState)
  }

  private async doStart(): Promise<void> {
    this.transition('starting')

    // Kill stale PID if present
    this.killStalePid()

    // Spawn the process
    try {
      this.process = this.config.spawn()
    } catch (err) {
      log.error(`[${this.config.name}] spawn failed:`, err)
      this.handleCrash()
      return
    }

    // Write PID file
    this.writePidFile()

    // Attach exit handler
    this.process.on('exit', (code, signal) => {
      if (!this.isIntentionallyStopped && this.state === 'running') {
        log.warn(`[${this.config.name}] unexpected exit code=${code} signal=${signal}`)
        this.clearLivenessInterval()
        this.clearHealthResetTimer()
        this.cleanPidFile()
        this.process = null
        this.handleCrash()
      } else if (!this.isIntentionallyStopped && this.state === 'starting') {
        log.warn(`[${this.config.name}] exited during startup code=${code} signal=${signal}`)
        this.clearReadinessTimer()
        this.cleanPidFile()
        this.process = null
        this.handleCrash()
      }
    })

    // Readiness probe
    if (this.config.readinessProbe) {
      const timeoutMs = this.config.readinessTimeoutMs ?? 30_000
      let resolved = false

      const readinessPromise = new Promise<boolean>((resolve) => {
        this.readinessTimer = setTimeout(() => {
          if (!resolved) {
            resolved = true
            resolve(false)
          }
        }, timeoutMs)

        this.pollReadiness(resolve, () => resolved)
      })

      const ready = await readinessPromise
      resolved = true
      this.clearReadinessTimer()

      if (this.isIntentionallyStopped || this.state !== 'starting') return

      if (ready) {
        this.enterRunning()
      } else {
        log.warn(`[${this.config.name}] readiness probe timed out after ${timeoutMs}ms`)
        if (this.process) {
          try {
            this.process.kill('SIGKILL')
          } catch {
            /* ignore */
          }
          this.process = null
        }
        this.cleanPidFile()
        this.handleCrash()
      }
    } else {
      // No readiness probe, go straight to running
      if (this.state === 'starting') {
        this.enterRunning()
      }
    }
  }

  private async pollReadiness(resolve: (value: boolean) => void, isResolved: () => boolean): Promise<void> {
    while (!isResolved()) {
      try {
        const ok = await this.config.readinessProbe!()
        if (ok && !isResolved()) {
          resolve(true)
          return
        }
      } catch {
        // Probe threw, try again
      }
      if (!isResolved()) {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }

  private enterRunning(): void {
    this.transition('running')
    this.consecutiveFailures = 0
    this.startLivenessProbe()
    this.startHealthResetTimer()
  }

  private handleCrash(): void {
    this.transition('crashed')
    this.restartCount++

    if (this.restartCount >= MAX_RESTARTS) {
      const reason = `${this.config.name} crashed ${this.restartCount} times, giving up`
      log.error(reason)
      this.transition('fatal')
      this.emit('fatal', reason)
      return
    }

    // Enter backoff
    this.transition('backoff')
    const attempt = this.restartCount - 1
    let delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS)
    delay += Math.random() * delay * 0.1 // jitter

    log.info(`[${this.config.name}] backoff #${this.restartCount}, retrying in ${Math.round(delay)}ms`)

    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null
      if (this.state === 'backoff') {
        this.doStart()
      }
    }, delay)
  }

  // --- Liveness probes ---

  private startLivenessProbe(): void {
    if (!this.config.livenessProbe) return

    this.livenessInterval = setInterval(async () => {
      if (this.state !== 'running') return

      try {
        const ok = await Promise.race([
          this.config.livenessProbe!(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('probe timeout')), HEALTH_PROBE_TIMEOUT_MS)
          ),
        ])

        if (ok) {
          this.consecutiveFailures = 0
        } else {
          this.onLivenessFail()
        }
      } catch {
        this.onLivenessFail()
      }
    }, HEALTH_PROBE_INTERVAL_MS)
  }

  private onLivenessFail(): void {
    this.consecutiveFailures++
    this.emit('health-check-failed', this.consecutiveFailures)
    log.warn(`[${this.config.name}] liveness probe failed (${this.consecutiveFailures}/${HEALTH_FAILURE_THRESHOLD})`)

    if (this.consecutiveFailures >= HEALTH_FAILURE_THRESHOLD) {
      log.error(`[${this.config.name}] liveness threshold exceeded, killing process`)
      this.clearLivenessInterval()
      this.clearHealthResetTimer()

      if (this.process) {
        try {
          this.process.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        this.process = null
      }
      this.cleanPidFile()
      this.handleCrash()
    }
  }

  // --- Health reset timer ---

  private startHealthResetTimer(): void {
    this.healthResetTimer = setTimeout(() => {
      if (this.state === 'running') {
        log.info(`[${this.config.name}] healthy for ${HEALTH_RESET_AFTER_MS}ms, resetting restart count`)
        this.restartCount = 0
      }
    }, HEALTH_RESET_AFTER_MS)
  }

  // --- PID file ---

  private writePidFile(): void {
    if (!this.config.pidFilePath || !this.process?.pid) return
    try {
      fs.writeFileSync(this.config.pidFilePath, String(this.process.pid), 'utf-8')
    } catch (err) {
      log.warn(`[${this.config.name}] failed to write PID file:`, err)
    }
  }

  private cleanPidFile(): void {
    if (!this.config.pidFilePath) return
    try {
      if (fs.existsSync(this.config.pidFilePath)) {
        fs.unlinkSync(this.config.pidFilePath)
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private killStalePid(): void {
    if (!this.config.pidFilePath) return
    try {
      if (!fs.existsSync(this.config.pidFilePath)) return
      const pid = parseInt(fs.readFileSync(this.config.pidFilePath, 'utf-8').trim(), 10)
      if (isNaN(pid)) return

      // Check if process is alive
      process.kill(pid, 0)
      // If we get here, process is alive - kill it
      log.warn(`[${this.config.name}] killing stale process pid=${pid}`)
      process.kill(pid, 'SIGKILL')
    } catch {
      // Process not running or no permission, clean up
    }
    this.cleanPidFile()
  }

  // --- Kill process gracefully ---

  private killProcess(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.process) {
        resolve()
        return
      }

      const proc = this.process
      let resolved = false

      const done = (): void => {
        if (resolved) return
        resolved = true
        if (this.killTimer) {
          clearTimeout(this.killTimer)
          this.killTimer = null
        }
        this.process = null
        resolve()
      }

      proc.on('exit', done)

      try {
        proc.kill('SIGTERM')
      } catch {
        done()
        return
      }

      this.killTimer = setTimeout(() => {
        if (!resolved) {
          log.warn(`[${this.config.name}] SIGTERM timeout, sending SIGKILL`)
          try {
            proc.kill('SIGKILL')
          } catch {
            // Already dead
          }
          // Give SIGKILL a moment, then resolve anyway
          this.killTimer = setTimeout(done, 500)
        }
      }, PROCESS_KILL_TIMEOUT_MS)
    })
  }

  // --- Timer cleanup ---

  private clearAllTimers(): void {
    this.clearBackoffTimer()
    this.clearLivenessInterval()
    this.clearHealthResetTimer()
    this.clearReadinessTimer()
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
  }

  private clearBackoffTimer(): void {
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
  }

  private clearLivenessInterval(): void {
    if (this.livenessInterval) {
      clearInterval(this.livenessInterval)
      this.livenessInterval = null
    }
  }

  private clearHealthResetTimer(): void {
    if (this.healthResetTimer) {
      clearTimeout(this.healthResetTimer)
      this.healthResetTimer = null
    }
  }

  private clearReadinessTimer(): void {
    if (this.readinessTimer) {
      clearTimeout(this.readinessTimer)
      this.readinessTimer = null
    }
  }
}
