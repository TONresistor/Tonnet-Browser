/**
 * Pure selector that derives the user-visible state of the cocoon stake panel
 * from balances + stake snapshot + pending intent.
 *
 * Mapping the (balances × stakeInfo × pendingWithdraw × runner) tuple to a
 * single discriminated union here lets the panel render a tiny switch instead
 * of nested conditionals, and lets us unit-test the decision matrix without
 * mounting React.
 */

import type { CocoonPendingWithdraw, CocoonStakeInfo } from '@shared/cocoon-types'

/** Below this dust threshold, the cocoon-node residual is too small to drain. */
export const CASHOUT_DUST_NANO = 100_000_000n
/** Below this dust threshold, the legacy owner V4R2 residual is too small to drain. */
export const OWNER_CASHOUT_DUST_NANO = 500_000_000n
/**
 * Stake amount used to fund the cocoon_node_wallet (canonical Cocoon Lite
 * Client value). On-chain floor is 15 TON; the standard runner sends 20.
 */
export const MIN_STAKE_NANO = 20_000_000_000n
/** Owner balance required to fund the cocoon wallet (covers stake + 0.1 TON gas). */
export const MIN_OWNER_TO_STAKE_NANO = 20_100_000_000n
/** Native (main) balance required to fund cocoon directly: stake + 0.1 TON gas. */
export const MIN_NATIVE_TO_FUND_NANO = 20_100_000_000n

export interface StakePanelContext {
  nativeBalance: bigint
  ownerBalance: bigint
  cocoonBalance: bigint
  stakeInfo: CocoonStakeInfo | null
  pendingWithdraw: CocoonPendingWithdraw | null
  /** Now in seconds, used for cooldown countdown. Pass Math.floor(Date.now()/1000). */
  nowSec: number
}

/**
 * Discriminated union: each `kind` represents a single screen layout. The UI
 * never needs to combine multiple branches — a screen is one and only one
 * kind at a time.
 */
export type StakeView =
  /** Pending full withdraw is in progress. Sub-state describes what stage. */
  | { kind: 'withdrawing'; stage: WithdrawStage; secondsRemaining: number; startedAt: number }
  /** Active stake — chat is available. UI can offer Unstake as a secondary. */
  | { kind: 'active'; stake: bigint; cocoonBalance: bigint }
  /** No stake, cocoon wallet has enough funds → primary "Start Cocoon". */
  | { kind: 'readyToStart'; cocoonBalance: bigint; canCashout: boolean }
  /** No stake, cocoon < min, but main wallet can fund → primary "Stake (transfer + start)". */
  | { kind: 'readyToFundAndStake'; nativeBalance: bigint; cocoonBalance: bigint; canCashout: boolean }
  /** No stake, main wallet too low — user must top up the main address first. */
  | { kind: 'fundOwnerFirst'; nativeBalance: bigint; ownerBalance: bigint; cocoonBalance: bigint; canCashout: boolean }

export type WithdrawStage =
  /** Refund request sent, on-chain not yet committed (state=closing, unlock_ts=0). */
  | 'requesting'
  /** Refund or claim tx was broadcast; waiting for the chain snapshot to move. */
  | 'confirming'
  /** Cooldown counting down on-chain. */
  | 'cooldown'
  /** Cooldown elapsed, driver about to claim refund. */
  | 'claiming'
  /** Refund claimed, driver about to drain cocoon → owner. */
  | 'cashingOut'
  /** Snapshot lost — driver still trying or just completed. */
  | 'finalizing'

/** Map a CocoonStakeInfo + pending intent to a withdraw stage. */
function deriveWithdrawStage(stakeInfo: CocoonStakeInfo | null, pendingWithdraw: CocoonPendingWithdraw): WithdrawStage {
  if (!stakeInfo) return 'finalizing'
  switch (stakeInfo.status) {
    case 'closing':
      return stakeInfo.unlockTs === 0 ? 'requesting' : 'cooldown'
    case 'cooldown':
      return 'cooldown'
    case 'refundable':
      return 'claiming'
    case 'closed':
      return 'cashingOut'
    case 'active':
      // Refund request is being sent or retried; the on-chain state has not
      // moved to closing yet.
      if (pendingWithdraw.lastActionAt) return 'confirming'
      return 'requesting'
  }
}

export function deriveStakeView(ctx: StakePanelContext): StakeView {
  // Pending withdraw always wins — no other action is meaningful.
  if (ctx.pendingWithdraw) {
    const stage = deriveWithdrawStage(ctx.stakeInfo, ctx.pendingWithdraw)
    const unlockTs = ctx.stakeInfo?.unlockTs ?? 0
    const secondsRemaining = unlockTs > 0 ? Math.max(0, unlockTs - ctx.nowSec) : 0
    return {
      kind: 'withdrawing',
      stage,
      secondsRemaining,
      startedAt: ctx.pendingWithdraw.startedAt,
    }
  }

  // Active stake → chat. Unstake is offered by the chat surface, not this view.
  if (ctx.stakeInfo?.status === 'active') {
    return {
      kind: 'active',
      stake: BigInt(ctx.stakeInfo.stake),
      cocoonBalance: ctx.cocoonBalance,
    }
  }

  // No active stake. The cashout button drains BOTH wallets to the native
  // browser wallet, so it should appear whenever EITHER side has enough to
  // actually move (above its respective gas reserve).
  const canCashout = ctx.cocoonBalance >= CASHOUT_DUST_NANO || ctx.ownerBalance >= OWNER_CASHOUT_DUST_NANO

  if (ctx.cocoonBalance >= MIN_STAKE_NANO) {
    return { kind: 'readyToStart', cocoonBalance: ctx.cocoonBalance, canCashout }
  }
  if (ctx.nativeBalance >= MIN_NATIVE_TO_FUND_NANO) {
    return {
      kind: 'readyToFundAndStake',
      nativeBalance: ctx.nativeBalance,
      cocoonBalance: ctx.cocoonBalance,
      canCashout,
    }
  }
  return {
    kind: 'fundOwnerFirst',
    nativeBalance: ctx.nativeBalance,
    ownerBalance: ctx.ownerBalance,
    cocoonBalance: ctx.cocoonBalance,
    canCashout,
  }
}
