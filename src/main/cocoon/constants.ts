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

/**
 * Narrow a raw client-SC state number (CocoonClient.getData returns `number`)
 * to the valid 0|1|2 union. The on-chain SC stores state in 2 bits but only
 * 0 (active), 1 (closing) and 2 (closed) are defined; anything else is a
 * protocol violation and throws so callers fail closed instead of silently
 * mislabelling an unknown state as 'closed'.
 */
export function narrowClientState(state: number): 0 | 1 | 2 {
  if (state === 0 || state === 1 || state === 2) return state
  throw new Error(`Unexpected cocoon client SC state: ${state}`)
}
