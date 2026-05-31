/**
 * Shared economic constants for the cocoon withdraw/recovery flows (nano-TON).
 *
 * Single source of truth for the gas/drain thresholds that were previously
 * duplicated across unstake.ts, recover-all.ts, recovery-driver.ts and
 * current-withdraw.ts.
 */

/**
 * Pre-sweep dust floor: below this balance, draining a cocoon-controlled
 * wallet would burn more in on-chain gas than it recovers, so the sweep is
 * skipped entirely.
 *
 * NOTE: this is distinct from the IPC handler's post-drain confirmation floor
 * (0.1 TON, DRAIN_FLOOR_NANO in ipc/handlers/cocoon.ts). That threshold
 * answers "has the drain settled?" after the fact; this one answers "is a
 * sweep worth attempting?" beforehand. They are intentionally different values
 * for different purposes and must not be merged.
 */
export const DRAIN_DUST_FLOOR_NANO = 50_000_000n // 0.05 TON

/**
 * Gas reserve attached to refund/claim messages sent to the cocoon client SC.
 * Must exceed Cocoon's 0.1 TON commission estimate (cocoon_client.fc
 * COMMISSION_ESTIMATE) so the message is accepted.
 */
export const REFUND_GAS_NANO = 200_000_000n // 0.2 TON
