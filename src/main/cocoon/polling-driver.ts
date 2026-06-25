/**
 * Base class for the cocoon background drivers (WithdrawDriver, RecoveryDriver).
 *
 * Owns the verbatim-duplicated polling scaffolding: a single armed timer, an
 * in-flight guard field, and start/stop/triggerTick. Subclasses implement the
 * per-tick work in tick() (and keep their own inflight guard + try/finally,
 * since the body differs per driver).
 *
 * NOTE: each driver operates on a DISTINCT scope (WithdrawDriver drives the
 * current identity via the runner; RecoveryDriver drives archived off-runner
 * wallets), so there is intentionally NO shared/global in-flight lock here.
 */
import { EventEmitter } from 'events'
import { errorMessage } from '../../shared/errors'
import type { createLogger } from '../../shared/logger'

type ScopedLogger = ReturnType<typeof createLogger>

export abstract class PollingDriver extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null
  /** Guards against overlapping ticks. Set/cleared by the subclass tick(). */
  protected inflight = false

  constructor(
    private readonly tickIntervalMs: number,
    private readonly log: ScopedLogger
  ) {
    super()
  }

  /** Advance the driver by one tick. Implemented by the subclass. */
  protected abstract tick(): Promise<void>

  private runTick(label: string): void {
    this.tick().catch((err) => this.log.warn(`${label}: ${errorMessage(err)}`))
  }

  /** Start the periodic ticker. Idempotent — a second call while armed is a no-op. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.runTick('tick error'), this.tickIntervalMs)
    // Fire one immediate tick so we don't wait the full interval on startup.
    setImmediate(() => this.runTick('initial tick error'))
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Trigger an immediate out-of-cadence tick (e.g. right after a user action). */
  triggerTick(): void {
    setImmediate(() => this.runTick('triggered tick error'))
  }
}
