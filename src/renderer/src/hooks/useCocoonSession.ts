/**
 * Single source of truth for Cocoon session state in the renderer.
 *
 * Owns: wallet info loading, resume-step resolution (Step 3 vs Step 4 by
 * on-chain balance), availability check, runner state subscription, and
 * auto-start when setup is complete but the runner is stopped.
 *
 * Consumed by the full page (ton://cocoon) and the sidebar — both render the
 * same branches without duplicating the IPC plumbing.
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  CocoonAvailability,
  CocoonPendingWithdraw,
  CocoonState,
  CocoonStakeInfo,
} from '../../../shared/cocoon-types'
import { isIpcError } from '@/lib/ipc-utils'
import { IPC_CHANNELS } from '@shared/ipc-channels'

/** cocoon_wallet balance (nano-TON) above which the funding step is considered done. */
const COCOON_WALLET_FUNDED_THRESHOLD_NANO = 1_000_000_000n
const TERMINAL_EMPTY_WALLET_NANO = 100_000_000n

export type WalletInfo = {
  ownerAddress: string
  nodeAddress: string
  nodePublicKeyHex: string
  createdAt: number
  setupCompletedAt: number | null
}

export type CocoonSessionPhase =
  | { kind: 'loading' }
  | { kind: 'walletError'; error: string }
  | { kind: 'needsSetup' }
  | { kind: 'resumeSetup'; resumeStep: 3 | 4; walletInfo: WalletInfo }
  | { kind: 'resumePending'; walletInfo: WalletInfo }
  | { kind: 'availabilityLoading'; walletInfo: WalletInfo }
  | { kind: 'availabilityError'; error: string; walletInfo: WalletInfo }
  | { kind: 'unavailable'; message: string; walletInfo: WalletInfo }
  /**
   * No active on-chain stake. Covers every non-active sub-state plus the
   * "no stake yet / closed" case where stakeInfo is null:
   *   - stakeInfo === null: never registered a client SC, or fully closed
   *   - stakeInfo.status === 'closing' | 'cooldown' | 'refundable' | 'closed'
   *
   * In all of these, inference is impossible (proxy refuses queries from a
   * closing/closed client, and there's nothing to query without a client),
   * so we replace the chat surface with the stake-management screen and skip
   * the runner auto-start that would otherwise loop on connection failures.
   */
  | {
      kind: 'unstaked'
      walletInfo: WalletInfo
      stakeInfo: CocoonStakeInfo | null
      /** Set when the user clicked the single-action "Unstake & withdraw". */
      pendingWithdraw: CocoonPendingWithdraw | null
    }
  | {
      kind: 'ready'
      walletInfo: WalletInfo
      state: CocoonState
      availability: CocoonAvailability
      startError: string | null
    }

export interface UseCocoonSessionResult {
  phase: CocoonSessionPhase
  refresh: () => void
  retryStart: () => void
}

export function useCocoonSession(): UseCocoonSessionResult {
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null | undefined>(undefined)
  const [walletInfoError, setWalletInfoError] = useState<string | null>(null)
  const [resumeStep, setResumeStep] = useState<3 | 4 | null>(null)
  const [availability, setAvailability] = useState<CocoonAvailability | null>(null)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [state, setState] = useState<CocoonState>({ kind: 'stopped' })
  // Surfaces start() failure so the UI can render an actionable error and a
  // Retry button instead of leaving the user stuck on a "Waiting…" screen.
  const [startError, setStartError] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  // Pre-start gate: snapshot of the on-chain stake state so we can skip
  // auto-starting the runner when the stake is in a non-active phase
  // (closing/cooldown/refundable/closed). Otherwise the runner loops on
  // proxy rejections ("client is closing") and burns CPU for nothing.
  const [stakeInfo, setStakeInfo] = useState<CocoonStakeInfo | null | undefined>(undefined)
  // Persistent pending-withdraw intent — the user clicked the single-action
  // "Unstake & withdraw" button and the main-process driver is auto-progressing
  // through cooldown → claim → cashout. The renderer renders a progress screen.
  const [pendingWithdraw, setPendingWithdraw] = useState<CocoonPendingWithdraw | null>(null)
  const [terminalEmptyWallet, setTerminalEmptyWallet] = useState(false)

  const refresh = useCallback(() => {
    window.electron.cocoon.walletInfo().then((info) => {
      setTerminalEmptyWallet(false)
      if (isIpcError(info)) {
        setWalletInfoError(info.error ?? 'Failed to load wallet info')
        setWalletInfo(null)
        return
      }
      setWalletInfoError(null)
      setWalletInfo(info as WalletInfo | null)
      setResumeStep(null)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setupComplete = walletInfo?.setupCompletedAt != null

  // Defensive: every failure mode falls back to Step 3 (IPC reject, error
  // envelope, non-numeric payload). Otherwise the gate gets stuck forever.
  useEffect(() => {
    if (!walletInfo || setupComplete || resumeStep !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const result = await Promise.race([
          window.electron.cocoon.getCocoonWalletBalance(),
          new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 8000)),
        ])
        if (cancelled) return
        if (isIpcError(result)) {
          setResumeStep(3)
          return
        }
        const balance = BigInt(result)
        setResumeStep(balance >= COCOON_WALLET_FUNDED_THRESHOLD_NANO ? 4 : 3)
      } catch {
        if (!cancelled) setResumeStep(3)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [walletInfo, setupComplete, resumeStep])

  // Subscribe to availability + state once setup is complete.
  useEffect(() => {
    if (!setupComplete) return
    let cancelled = false
    window.electron.cocoon.availability().then((result) => {
      if (cancelled) return
      if (isIpcError(result)) {
        setAvailabilityError(result.error ?? 'Failed to load availability')
        return
      }
      setAvailabilityError(null)
      setAvailability(result as CocoonAvailability)
    })
    // Read the stake snapshot first. We need it before deciding whether
    // to auto-start the runner — in non-active phases, starting would just
    // loop on proxy rejections.
    window.electron.cocoon.stakeInfo().then(async (stakeResult) => {
      if (cancelled) return
      const stakeIpcErr = isIpcError(stakeResult)
      const stake = stakeIpcErr ? null : (stakeResult as CocoonStakeInfo | null)
      setStakeInfo(stake)
      const pending = await window.electron.cocoon.flowPending()
      if (cancelled) return
      const pendingIntent = isIpcError(pending) ? null : pending
      setPendingWithdraw(pendingIntent)

      const terminalStake = !stake || stake.status === 'closed'
      if (terminalStake && !pendingIntent) {
        const [ownerBalanceRes, cocoonBalanceRes] = await Promise.allSettled([
          window.electron.cocoon.getOwnerBalance(),
          window.electron.cocoon.getCocoonWalletBalance(),
        ])
        if (cancelled) return
        const ownerBalance =
          ownerBalanceRes.status === 'fulfilled' && !isIpcError(ownerBalanceRes.value)
            ? BigInt(ownerBalanceRes.value as string)
            : null
        const cocoonBalance =
          cocoonBalanceRes.status === 'fulfilled' && !isIpcError(cocoonBalanceRes.value)
            ? BigInt(cocoonBalanceRes.value as string)
            : null
        setTerminalEmptyWallet(
          ownerBalance !== null &&
            cocoonBalance !== null &&
            ownerBalance < TERMINAL_EMPTY_WALLET_NANO &&
            cocoonBalance < TERMINAL_EMPTY_WALLET_NANO
        )
      } else {
        setTerminalEmptyWallet(false)
      }

      // Now read the runner state. Decide whether to auto-start based on stake.
      const statusResult = await window.electron.cocoon.status()
      if (cancelled) return
      if (isIpcError(statusResult)) return
      const initial = statusResult as CocoonState
      setState(initial)

      // Auto-start only when there is an *active* stake. Every other case
      // (stake null = never registered or fully closed; closing/cooldown =
      // proxy refuses queries; refundable/closed = user must explicitly act)
      // is left to manual start via the StakePanel. This avoids the burn-CPU
      // loop where the runner retries proxy connections forever.
      const stakeBlocksRunner = pendingIntent != null || stake?.status !== 'active'

      // If the runner is busy retrying connections (starting/crashed) but the
      // stake is non-active, it will loop forever on proxy rejections — stop
      // it so the UI can show the stake panel cleanly.
      if (
        stakeBlocksRunner &&
        (initial.kind === 'starting' || initial.kind === 'crashed' || initial.kind === 'ready')
      ) {
        try {
          await window.electron.cocoon.stop()
        } catch {
          // Stop failures are non-fatal here — the UI fallback already covers it.
        }
        return
      }

      if (initial.kind === 'stopped' && !stakeBlocksRunner) {
        setStartError(null)
        try {
          const startResult = await window.electron.cocoon.start()
          if (cancelled) return
          if (!startResult.success) {
            setStartError(startResult.error ?? 'Failed to start Cocoon')
          }
        } catch (err) {
          if (!cancelled) setStartError((err as Error).message ?? 'Failed to start Cocoon')
        }
      }
    })
    const offState = window.electron.on(IPC_CHANNELS.COCOON_STATE_CHANGED, (nextState) => {
      setState(nextState)
      if (nextState.kind === 'ready') setStartError(null)
    })

    // Withdraw driver pushes events as it auto-progresses. Refresh the snapshot
    // and the pending flag so the UI converges with the on-chain state without
    // needing the user to do anything.
    const offWithdraw = window.electron.on(IPC_CHANNELS.COCOON_WITHDRAW_EVENT, (e) => {
      if (e.type === 'completed') {
        setPendingWithdraw(null)
        refresh()
      }
      // Refresh stake snapshot on every progress/completion event.
      window.electron.cocoon.stakeInfo().then((s) => {
        if (cancelled) return
        if (isIpcError(s)) return
        setStakeInfo(s as CocoonStakeInfo | null)
      })
    })

    return () => {
      cancelled = true
      offState()
      offWithdraw()
    }
    // retryNonce is intentionally a dep so retryStart() re-fires the auto-start
    // path with a clean cancellation/cleanup of the previous subscription.
  }, [setupComplete, retryNonce, refresh])

  const retryStart = useCallback(() => {
    setStartError(null)
    setRetryNonce((n) => n + 1)
  }, [])

  const phase = derivePhase({
    walletInfo,
    walletInfoError,
    setupComplete,
    resumeStep,
    availability,
    availabilityError,
    state,
    startError,
    stakeInfo,
    pendingWithdraw,
    terminalEmptyWallet,
  })

  return { phase, refresh, retryStart }
}

/**
 * Map an unstaked phase's stake status to a header i18n key suffix. Used by the
 * full page and the sidebar to render the same descriptive title/description
 * without duplicating the switch.
 */
export type UnstakedHeaderKey = 'noStake' | 'closing' | 'cooldown' | 'refundable' | 'closed' | 'withdrawing'

export function unstakedHeaderKey(
  status: CocoonStakeInfo['status'] | null,
  pendingWithdraw: CocoonPendingWithdraw | null = null
): UnstakedHeaderKey {
  // Pending withdraw always wins — the user is in the middle of an exit, the
  // header should communicate progress, not the (intermediate) stake state.
  if (pendingWithdraw) return 'withdrawing'
  switch (status) {
    case 'closing':
      return 'closing'
    case 'cooldown':
      return 'cooldown'
    case 'refundable':
      return 'refundable'
    case 'closed':
      return 'closed'
    case 'active':
    case null:
    default:
      return 'noStake'
  }
}

function derivePhase(args: {
  walletInfo: WalletInfo | null | undefined
  walletInfoError: string | null
  setupComplete: boolean
  resumeStep: 3 | 4 | null
  availability: CocoonAvailability | null
  availabilityError: string | null
  state: CocoonState
  startError: string | null
  stakeInfo: CocoonStakeInfo | null | undefined
  pendingWithdraw: CocoonPendingWithdraw | null
  terminalEmptyWallet: boolean
}): CocoonSessionPhase {
  const {
    walletInfo,
    walletInfoError,
    setupComplete,
    resumeStep,
    availability,
    availabilityError,
    state,
    startError,
    stakeInfo,
    pendingWithdraw,
    terminalEmptyWallet,
  } = args
  if (walletInfo === undefined) return { kind: 'loading' }
  if (walletInfo === null) {
    if (walletInfoError) return { kind: 'walletError', error: walletInfoError }
    return { kind: 'needsSetup' }
  }
  if (terminalEmptyWallet) return { kind: 'needsSetup' }
  if (!setupComplete) {
    if (resumeStep === null) return { kind: 'resumePending', walletInfo }
    return { kind: 'resumeSetup', resumeStep, walletInfo }
  }
  if (!availability) {
    if (availabilityError) return { kind: 'availabilityError', error: availabilityError, walletInfo }
    return { kind: 'availabilityLoading', walletInfo }
  }
  if (!availability.available) {
    return { kind: 'unavailable', message: availability.message ?? 'Cocoon AI not available', walletInfo }
  }
  // Stake snapshot still loading (undefined) — keep the page in availability-
  // loading limbo rather than briefly flashing the unstaked panel.
  if (stakeInfo === undefined) return { kind: 'availabilityLoading', walletInfo }
  // Any non-active stake (including null = no stake at all) routes to the
  // unstaked panel, which exposes Start Cocoon / Cashout / Claim refund as
  // appropriate. Only an active stake unlocks the chat surface.
  if (!stakeInfo || stakeInfo.status !== 'active') {
    return { kind: 'unstaked', walletInfo, stakeInfo, pendingWithdraw }
  }
  return { kind: 'ready', walletInfo, state, availability, startError }
}
