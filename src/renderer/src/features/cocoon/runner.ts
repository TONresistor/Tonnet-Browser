/**
 * Pure decision for the Cocoon runner auto-start/stop, shared by every
 * useCocoonSession instance so the logic (and its coordination) is testable.
 */

/**
 * The runner should stay stopped unless there is an *active* stake and no
 * pending withdraw intent. Every other case (no stake, closing/cooldown/
 * refundable/closed, or a pending intent) is left to explicit user action —
 * auto-starting would burn CPU retrying proxy connections forever.
 */
export function stakeBlocksRunner(hasPendingIntent: boolean, stakeStatus: string | undefined): boolean {
  return hasPendingIntent || stakeStatus !== 'active'
}
