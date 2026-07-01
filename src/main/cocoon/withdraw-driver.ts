/**
 * Background driver that auto-progresses a "complete withdraw" intent.
 *
 * The on-chain unstake is a multi-step protocol (request_refund → cooldown →
 * claim_refund → SC closes → cocoon wallet still holds residual funds), but
 * from the user's perspective they clicked one button: "Unstake & withdraw".
 * This driver hides every intermediate step.
 *
 * State machine (driven by the on-chain stake status):
 *   pending flag set + status='active'      → send direct node-signed refund request
 *   pending flag set + status='closing'     → wait
 *   pending flag set + status='cooldown'    → wait, polling occasionally
 *   pending flag set + status='refundable'  → send direct node-signed claim request
 *   pending flag set + status='closed'      → cashout residual, clear flag
 *   pending flag cleared                    → no-op (driver idle)
 *
 * Crash-safe: the flag lives in cocoon-stake.json, so closing the app during
 * cooldown doesn't lose the intent. Next start picks up the driver where it
 * left off.
 *
 * The driver only does work when the bridge is connected; otherwise it skips
 * the tick and retries on the next interval.
 */

import { errorMessage } from '../../shared/errors'
import { PollingDriver } from './polling-driver'
import { createLogger } from '../../shared/logger'
import { getStakeCacheStore } from './stake-cache'
import { getStakeInfo, cashout } from './unstake'
import { driveCurrentWithdrawStep, type TopUpNodeWallet } from './current-withdraw'
import { retireCurrentCocoonWallet } from './retire-wallet'
import type { CocoonManager } from './manager'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'
import type { CocoonStakeInfo, WithdrawDriverEvent } from '../../shared/cocoon-types'

const log = createLogger('cocoon:withdraw-driver')

/** Idle poll cadence. The driver wakes more often during cooldown via state-change ticks. */
const TICK_INTERVAL_MS = 30_000

export type { WithdrawDriverEvent }

export class WithdrawDriver extends PollingDriver {
  constructor(
    private manager: CocoonManager,
    private getBridge: () => WsBridgeClient | null,
    private getNativeAddress: () => string | null,
    private topUpNodeWallet?: TopUpNodeWallet
  ) {
    super(TICK_INTERVAL_MS, log)
  }

  /** Run a single tick that surfaces errors (used by the user-initiated retry path). */
  async runUserInitiatedTick(): Promise<void> {
    await this.guardedRun(true)
  }

  protected async tick(surfaceErrors = false): Promise<void> {
    const cache = await getStakeCacheStore().load()
    const intent = cache?.pendingWithdraw ?? null
    if (!intent) return // no pending exit; driver idle

    const bridge = this.getBridge()
    if (!bridge) {
      if (surfaceErrors) throw new Error('Bridge not connected — wallet not initialized')
      return // bridge offline, retry next tick
    }

    try {
      const info = await getStakeInfo(this.manager, bridge)

      // Stake snapshot vanished entirely (no SC, no cache). Treat as completed.
      if (!info) {
        log.info('Pending withdraw with no stake snapshot — clearing flag')
        await getStakeCacheStore().clearPendingWithdraw()
        this.emit('event', { type: 'completed' } satisfies WithdrawDriverEvent)
        return
      }

      this.emit('event', { type: 'progress', status: info.status } satisfies WithdrawDriverEvent)

      switch (info.status) {
        case 'active':
          await this.driveDirectWithdrawStep()
          break

        case 'closing':
        case 'cooldown':
          // On-chain timer running. Nothing to do until cooldown elapses.
          break

        case 'refundable':
          await this.driveDirectWithdrawStep()
          break

        case 'closed':
          await this.driveCashout(info)
          break
      }
    } catch (err) {
      const message = errorMessage(err)
      log.warn(`tick failed: ${message}`)
      this.emit('event', {
        type: 'error',
        message,
        recoverable: true,
      } satisfies WithdrawDriverEvent)
      if (surfaceErrors) throw err
    }
  }

  /**
   * Active/refundable → use the node wallet directly. This avoids depending
   * on cocoon-runner readiness, which can be blocked exactly when the node
   * wallet has insufficient operational balance.
   */
  private async driveDirectWithdrawStep(): Promise<void> {
    const bridge = this.getBridge()
    if (!bridge) return
    const native = this.getNativeAddress()
    if (!native) {
      throw new Error('Native wallet not initialized — cannot withdraw Cocoon stake')
    }
    const result = await driveCurrentWithdrawStep({
      manager: this.manager,
      bridge,
      nativeAddress: native,
      topUpNodeWallet: this.topUpNodeWallet,
    })
    log.info(`Direct current withdraw step: ${result.status} client=${result.clientSCAddress.slice(0, 8)}…`)
  }

  /**
   * Closed → sweep cocoon-controlled balances back to the user's native wallet
   * and clear the flag. Always attempts the sweep (the cashout helper handles
   * dust thresholds internally and skips no-op sweeps silently).
   */
  private async driveCashout(info: CocoonStakeInfo): Promise<void> {
    const bridge = this.getBridge()
    if (!bridge) return

    const native = this.getNativeAddress()
    if (!native) {
      log.warn('Cashout skipped: native wallet address not available yet')
      return
    }

    try {
      log.info(`Driving cashout (cocoon residual ${info.cocoonWalletBalance}) → native`)
      const result = await cashout(this.manager, bridge, native)
      this.emit('event', {
        type: 'cashout-done',
        sentAmount: result.totalSent,
        bocHash: result.txs[0]?.bocHash ?? '',
      } satisfies WithdrawDriverEvent)
    } catch (err) {
      const msg = errorMessage(err)
      // 'Nothing to cashout' is the natural terminal — flag the withdraw done.
      if (!msg.includes('Nothing to cashout')) throw err
      log.info('Cashout: nothing to drain, terminal state reached')
    }

    await retireCurrentCocoonWallet('withdraw-completed')
    this.emit('event', { type: 'completed' } satisfies WithdrawDriverEvent)
  }
}

/**
 * Composite IPC entry point: arm the persistent flag and send the on-chain
 * refund request. Returns immediately — the driver finishes the work.
 *
 * Does not require cocoon-runner readiness. The periodic driver signs direct
 * node-wallet messages and retries from persisted state until the withdraw
 * reaches the terminal cashout phase.
 */
export async function startFullWithdraw(driver: WithdrawDriver, _manager: CocoonManager): Promise<void> {
  await getStakeCacheStore().setPendingWithdraw({ startedAt: Date.now() })
  await driver.runUserInitiatedTick()
}
