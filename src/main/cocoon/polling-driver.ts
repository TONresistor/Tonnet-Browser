/**
 * Base class for the cocoon background drivers (WithdrawDriver, RecoveryDriver).
 *
 * Owns the polling scaffolding: a single armed timer plus the ONE in-flight
 * guard every entry path funnels through (guardedRun). Subclasses implement the
 * per-tick work in tick() and no longer manage the guard themselves — an earlier
 * design set the flag AFTER an await inside each subclass, so two overlapping
 * ticks (timer refire while a slow on-chain tick still runs, or a user-initiated
 * tick racing the timer) could both pass the check and double-send txs.
 *
 * Each driver operates on a DISTINCT scope (WithdrawDriver drives the current
 * identity via the runner; RecoveryDriver drives archived off-runner wallets),
 * so the guard is per-driver, not global.
 */
import { EventEmitter } from 'events'
import { errorMessage } from '../../shared/errors'
import { RepetitionAggregator, type createLogger } from '../../shared/logger'

type ScopedLogger = ReturnType<typeof createLogger>

export abstract class PollingDriver extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null
  /**
   * True while a tick() is executing. Owned EXCLUSIVELY by guardedRun and set
   * synchronously before the first await, so no entry path can observe a stale
   * value across an await (the TOCTOU that let two ticks run at once).
   */
  private inflight = false
  /**
   * Set when a run is requested while a tick is already in flight. Triggers a
   * single coalesced follow-up tick when the current one finishes, so an intent
   * persisted mid-tick is picked up promptly instead of waiting a full interval.
   */
  private rerunQueued = false
  private readonly failures: RepetitionAggregator

  constructor(
    private readonly tickIntervalMs: number,
    private readonly log: ScopedLogger
  ) {
    super()
    this.failures = new RepetitionAggregator(log)
  }

  /**
   * Advance the driver by one tick. Implemented by the subclass. The optional
   * flag asks the tick to rethrow errors for a user-initiated invocation.
   */
  protected abstract tick(surfaceErrors?: boolean): Promise<void>

  /**
   * The single choke-point every entry path (timer, triggerTick, user-initiated)
   * funnels through. Sets the in-flight flag synchronously before any await, so
   * concurrent invocations can never execute tick() twice at once. A run
   * requested while busy is coalesced into exactly one trailing tick.
   */
  protected guardedRun(surfaceErrors = false): Promise<void> {
    if (this.inflight) {
      this.rerunQueued = true
      return Promise.resolve()
    }
    this.inflight = true
    // tick() is always async (never throws synchronously), so calling it
    // directly starts the work up to its first await within this call.
    return this.tick(surfaceErrors).finally(() => {
      this.inflight = false
      if (this.rerunQueued) {
        this.rerunQueued = false
        this.triggerTick()
      }
    })
  }

  private runGuarded(label: string): void {
    this.guardedRun().then(
      () => this.failures.recovered('poll', 'background.poll.restored', 'background polling restored'),
      (err) =>
        this.failures.record('poll', 'background.poll.failed', 'background polling failed', {
          trigger: label,
          error: errorMessage(err),
        })
    )
  }

  /** Start the periodic ticker. Idempotent — a second call while armed is a no-op. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.runGuarded('tick error'), this.tickIntervalMs)
    // Fire one immediate tick so we don't wait the full interval on startup.
    setImmediate(() => this.runGuarded('initial tick error'))
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Trigger an immediate out-of-cadence tick (e.g. right after a user action). */
  triggerTick(): void {
    setImmediate(() => this.runGuarded('triggered tick error'))
  }
}
