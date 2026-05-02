/**
 * Shared types for Cocoon AI integration.
 * These cross main <-> renderer via IPC, so no main-only or renderer-only deps.
 */

export type CocoonPhase = 'client-runner' | 'sync' | 'staking'

export type CocoonState =
  | { kind: 'stopped' }
  | { kind: 'starting'; phase: CocoonPhase }
  | { kind: 'ready'; httpPort: number }
  | { kind: 'crashed'; error: string }

export type CocoonAvailability =
  | { available: true }
  | { available: false; reason: 'platform' | 'arch' | 'glibc'; message: string }

export interface CocoonStartParams {
  ownerAddress: string
  nodeWalletKeyBase64: string
  rootContractAddress: string
  instance?: number
  toncenterApiKey?: string
}

export interface CocoonLogEvent {
  source: 'runner'
  line: string
}

/**
 * UI-facing stake lifecycle state derived from the runner's reported sc_state
 * combined with the on-chain client SC state and unlock_ts:
 *
 *   active     — state=normal, runner is paying for inference
 *   closing    — request_refund just sent, on-chain confirmation pending
 *   cooldown   — state=closing, unlock_ts is in the future
 *   refundable — state=closing, unlock_ts elapsed (second close call will close)
 *   closed     — state=closed, stake fully refunded to cocoon wallet
 */
export type CocoonStakeStatus = 'active' | 'closing' | 'cooldown' | 'refundable' | 'closed'

export interface CocoonPendingWithdraw {
  /** Unix ms timestamp when the user requested the full exit. */
  startedAt: number
  /** Unix ms timestamp of the last direct refund/claim tx broadcast. */
  lastActionAt?: number
  /** BOC hash of the last direct refund/claim tx broadcast. */
  lastBocHash?: string
}

/**
 * Snapshot for the renderer's stake panel. All bigint fields are nano-TON
 * decimal strings (so they cross IPC without loss).
 */
export interface CocoonStakeInfo {
  status: CocoonStakeStatus
  /** Proxy SC address used for runner control endpoints (close/withdraw). */
  proxySCAddress: string
  /** Client SC address (for on-chain queries by anyone interested). */
  clientSCAddress: string
  /** Raw runner-reported on-chain state (0=normal, 1=closing, 2=closed). */
  runnerState: 0 | 1 | 2
  /** Authoritative on-chain state from CocoonClient.getData(). null when read failed. */
  onchainState: 0 | 1 | 2 | null
  /** Client SC balance (decimal nano-TON). */
  balance: string
  /** Required stake (decimal nano-TON). */
  stake: string
  /** Unix timestamp when refund unlocks (0 in active state). */
  unlockTs: number
  tokensUsed: string
  tokensPayed: string
  /** Residual balance in the cocoon node wallet (recoverable via cashout). */
  cocoonWalletBalance: string
  /**
   * Lifecycle of the cocoon-runner process. Lets the UI distinguish
   * "stake exists but runner is offline" (cached + on-chain only) from
   * "stake exists and the runner is paying for inference" (live).
   */
  runnerStatus: 'stopped' | 'starting' | 'ready' | 'crashed'
}

export interface CocoonCashoutTx {
  /** Which cocoon-controlled wallet was drained. */
  source: 'node' | 'owner'
  bocHash: string
  /** Decimal nano-TON string. */
  sentAmount: string
}

export interface CocoonCashoutResult {
  /** Total drained across every successful sub-tx, decimal nano-TON. */
  totalSent: string
  /** One entry per sweep that actually moved funds. May contain 0..N items. */
  txs: CocoonCashoutTx[]
}

export interface CocoonRecoveryAllTx {
  source:
    | 'current-node'
    | 'current-owner'
    | 'archived-node'
    | 'archived-owner'
    | 'client-refund-request'
    | 'client-refund-claim'
  address: string
  /** Decimal nano-TON string. Opcode txs use "0" because they request movement from the client SC. */
  amount: string
  bocHash: string
  archivedAt?: number
}

export interface CocoonRecoveryAllResult {
  success: true
  /** Sum of directly drained wallet balances requested for transfer, decimal nano-TON. */
  totalRequested: string
  txs: CocoonRecoveryAllTx[]
  /** Only populated when the on-chain client SC reports a future unlock timestamp. */
  locked: Array<{
    clientSCAddress: string
    unlockTs: number
    archivedAt?: number
  }>
  skipped: Array<{
    reason: string
    address?: string
    archivedAt?: number
  }>
}
