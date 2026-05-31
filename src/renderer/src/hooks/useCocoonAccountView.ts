/**
 * Hook that exposes a single, flat snapshot of the Cocoon "account" — the
 * mental model the user sees on ton://wallet's Cocoon tab.
 *
 * The on-chain plumbing (cocoon node wallet, owner V4R2, SC stake) is rolled
 * into one number (`totalNano`) and one user-facing status. Activation is a
 * single atomic IPC call (`cocoon.flowStake`) that handles draining residuals,
 * archiving the prior identity, generating a fresh one, funding it, and
 * starting the runner.
 *
 * This is intentionally a thin polling hook rather than a global store: the
 * wallet page and sidebar each instantiate it and stay in sync because both
 * read the same IPC state.
 */

import { errorMessage } from '@shared/errors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isIpcError } from '@/lib/ipc-utils'
import { createLogger } from '@/logger'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import type { CocoonPendingWithdraw, CocoonStakeInfo } from '../../../shared/cocoon-types'

const log = createLogger('cocoon:account-view')

const POLL_IDLE_MS = 30_000
const POLL_ACTIVE_MS = 5_000

export type CocoonAccountStatus =
  /** Initial fetch in flight. */
  | 'loading'
  /** Cocoon binaries unavailable on this OS or this build. */
  | 'unavailable'
  /** No wallet, or wallet without active stake — primary CTA: Activate. */
  | 'idle'
  /** flowStake in flight or runner still starting after a recent activate(). */
  | 'activating'
  /** Stake registered, runner ready (or about to be). */
  | 'active'
  /** A withdraw is auto-progressing through cooldown / claim / cashout. */
  | 'withdrawing'

export interface CocoonAccountSnapshot {
  status: CocoonAccountStatus
  /** Sum of cocoon node residual + legacy owner residual, in nano-TON. Active stake excluded. */
  residualNano: bigint
  /** On-chain staked amount in nano-TON (0 unless status='active' or withdrawing from active). */
  stakedNano: bigint
  /** residualNano + stakedNano. The single number to show as "Cocoon balance". */
  totalNano: bigint
  /** Raw stake snapshot for the withdraw timeline. */
  stakeInfo: CocoonStakeInfo | null
  /** Raw pending intent for the withdraw timeline. */
  pendingWithdraw: CocoonPendingWithdraw | null
  /** Last error encountered while refreshing or activating. Non-fatal — UI keeps showing the cached snapshot. */
  error: string | null
}

const INITIAL: CocoonAccountSnapshot = {
  status: 'loading',
  residualNano: 0n,
  stakedNano: 0n,
  totalNano: 0n,
  stakeInfo: null,
  pendingWithdraw: null,
  error: null,
}

export interface UseCocoonAccountViewResult {
  snapshot: CocoonAccountSnapshot
  /** Force an immediate refresh — call after a user action so the UI doesn't lag. */
  refresh: () => void
  /**
   * Trigger the atomic ACTIVATE flow (rotate identity → fund → stake → start
   * runner). Flips status to `activating` immediately. Resolves on completion;
   * rejects with an Error whose message is also exposed in `snapshot.error`.
   */
  activate: () => Promise<void>
}

export function useCocoonAccountView(): UseCocoonAccountViewResult {
  const [snapshot, setSnapshot] = useState<CocoonAccountSnapshot>(INITIAL)
  const [activating, setActivating] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)
  // Mirror `activating` into a ref so fetchOnce can read the current value
  // without becoming a stable callback dependency.
  const activatingRef = useRef(false)
  activatingRef.current = activating
  // Mirror the latest snapshot into a ref so the polling loop can read the
  // current status for cadence selection without re-creating the effect on
  // every status change (which would cancel the in-flight timer).
  const snapshotRef = useRef<CocoonAccountSnapshot>(INITIAL)
  // Sticky-activating safety: once activate() resolves, keep forcing status
  // 'activating' until either (a) a poll observes stakeInfo.status === 'active'
  // or (b) 60s elapse without seeing 'active' (then we fall back to natural
  // derivation — stale UI is better than an infinite spinner).
  const stickyActivatingRef = useRef(false)
  const stickyActivatingDeadlineRef = useRef(0)

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const exists = await window.electron.cocoon.walletExists()
      if (!exists) {
        const idle: CocoonAccountSnapshot = { ...INITIAL, status: 'idle' }
        snapshotRef.current = idle
        setSnapshot(idle)
        return
      }
      const [availabilityRes, stakeRes, pendingRes, ownerRes, cocoonRes, statusRes] = await Promise.allSettled([
        window.electron.cocoon.availability(),
        window.electron.cocoon.stakeInfo(),
        window.electron.cocoon.flowPending(),
        window.electron.cocoon.getOwnerBalance(),
        window.electron.cocoon.getCocoonWalletBalance(),
        window.electron.cocoon.status(),
      ])
      if (cancelledRef.current) return

      const availability =
        availabilityRes.status === 'fulfilled' && !isIpcError(availabilityRes.value)
          ? (availabilityRes.value as { available: boolean })
          : null
      if (availability && availability.available === false) {
        const unavailable: CocoonAccountSnapshot = { ...INITIAL, status: 'unavailable' }
        snapshotRef.current = unavailable
        setSnapshot(unavailable)
        return
      }

      const stakeInfo =
        stakeRes.status === 'fulfilled' && !isIpcError(stakeRes.value)
          ? (stakeRes.value as CocoonStakeInfo | null)
          : null
      const pending =
        pendingRes.status === 'fulfilled' && !isIpcError(pendingRes.value)
          ? (pendingRes.value as CocoonPendingWithdraw | null)
          : null
      const ownerNano =
        ownerRes.status === 'fulfilled' && !isIpcError(ownerRes.value) ? BigInt(ownerRes.value as string) : 0n
      const cocoonNano =
        cocoonRes.status === 'fulfilled' && !isIpcError(cocoonRes.value) ? BigInt(cocoonRes.value as string) : 0n

      // Active or mid-withdraw stake counts toward the "Cocoon balance" total
      // so the user sees their funds even while the on-chain unstake cycle
      // (closing → cooldown → refundable → closed) is in flight.
      const stakeStillCounted =
        stakeInfo &&
        (stakeInfo.status === 'active' ||
          stakeInfo.status === 'closing' ||
          stakeInfo.status === 'cooldown' ||
          stakeInfo.status === 'refundable')
      const stakedNano = stakeStillCounted ? BigInt(stakeInfo.stake) : 0n
      const residualNano = ownerNano + cocoonNano
      const totalNano = stakedNano + residualNano

      const runnerKind =
        statusRes.status === 'fulfilled' && !isIpcError(statusRes.value)
          ? (statusRes.value as { kind: string }).kind
          : 'stopped'

      // Sticky-activating bookkeeping: clear the flag once we observe an
      // active stake, or once the safety deadline has passed.
      if (stickyActivatingRef.current) {
        if (stakeInfo?.status === 'active') {
          stickyActivatingRef.current = false
        } else if (Date.now() >= stickyActivatingDeadlineRef.current) {
          stickyActivatingRef.current = false
        }
      }

      let status: CocoonAccountStatus
      // A non-active stake (closing, cooldown, refundable) means the user has
      // a pending unstake on the chain — even if the renderer-side
      // pendingWithdraw flag was never set (e.g. a previous app session set
      // the flag, the driver completed the local cashout and cleared the flag,
      // but the SC itself is still in cooldown). Treat it as 'withdrawing' so
      // the UI doesn't lie about its state.
      if (
        pending ||
        stakeInfo?.status === 'closing' ||
        stakeInfo?.status === 'cooldown' ||
        stakeInfo?.status === 'refundable'
      ) {
        status = 'withdrawing'
      } else if (stakeInfo?.status === 'active') {
        status = 'active'
      } else if (activatingRef.current && runnerKind === 'starting') {
        // While flowStake is in flight (or has just landed and the runner is
        // still booting) keep showing 'activating' so the UI doesn't briefly
        // bounce back to 'idle'.
        status = 'activating'
      } else if (stickyActivatingRef.current) {
        // After flowStake() resolved, keep the spinner up until at least one
        // poll has observed an active stake (or the 60s safety timeout fires).
        status = 'activating'
      } else {
        status = 'idle'
      }

      const next: CocoonAccountSnapshot = {
        status,
        residualNano,
        stakedNano,
        totalNano,
        stakeInfo,
        pendingWithdraw: pending,
        error: null,
      }
      snapshotRef.current = next
      setSnapshot(next)
    } catch (err) {
      const message = errorMessage(err)
      log.warn(`account view refresh failed: ${message}`)
      setSnapshot((prev) => {
        const next = { ...prev, error: message }
        snapshotRef.current = next
        return next
      })
    }
  }, [])

  const refresh = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    void fetchOnce()
  }, [fetchOnce])

  const activate = useCallback(async (): Promise<void> => {
    setActivating(true)
    // Optimistically flip the visible status to 'activating' so the UI doesn't
    // lag the click. The next fetchOnce() will reconcile.
    setSnapshot((prev) => {
      const next = { ...prev, status: 'activating' as const, error: null }
      snapshotRef.current = next
      return next
    })
    try {
      const result = await window.electron.cocoon.flowStake()
      if (!result.success) {
        const error = result.error ?? 'Activation failed'
        setSnapshot((prev) => {
          const next = { ...prev, status: 'idle' as const, error }
          snapshotRef.current = next
          return next
        })
        throw new Error(error)
      }
      // Success — keep the activating spinner sticky until a poll observes
      // stakeInfo.status === 'active' (or the safety deadline fires). The
      // deadline must exceed the backend's READINESS_TIMEOUT_MS (180s in
      // CocoonManager) plus margin for on-chain confirmation. The runner
      // typically reaches 'ready' in 60-120s after the staking phase begins.
      stickyActivatingRef.current = true
      stickyActivatingDeadlineRef.current = Date.now() + 240_000
      await fetchOnce()
    } catch (e) {
      const message = (e as Error).message ?? 'Activation failed'
      // On failure, drop the sticky flag so the UI doesn't get stuck.
      stickyActivatingRef.current = false
      setSnapshot((prev) => {
        const next = { ...prev, status: 'idle' as const, error: message }
        snapshotRef.current = next
        return next
      })
      throw e instanceof Error ? e : new Error(message)
    } finally {
      setActivating(false)
    }
  }, [fetchOnce])

  useEffect(() => {
    cancelledRef.current = false
    let running = true
    const tick = async (): Promise<void> => {
      if (!running) return
      await fetchOnce()
      if (!running) return
      // Poll faster while withdraw or activation is in progress — the UI
      // needs to react to driver / runner events without lag. Read the
      // current status from the ref so the cadence reflects the latest
      // snapshot rather than the value captured on the first effect run.
      const currentStatus = snapshotRef.current.status
      const delay = currentStatus === 'withdrawing' || currentStatus === 'activating' ? POLL_ACTIVE_MS : POLL_IDLE_MS
      timerRef.current = setTimeout(tick, delay)
    }
    void tick()

    const offWithdraw = window.electron.on(IPC_CHANNELS.COCOON_WITHDRAW_EVENT, (() => {
      void fetchOnce()
    }) as (...args: unknown[]) => void)

    return () => {
      running = false
      cancelledRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      offWithdraw()
    }
    // The cadence is computed from snapshotRef.current.status (kept in sync
    // by every setSnapshot call) so we don't restart the loop on every
    // status change.
  }, [fetchOnce])

  return { snapshot, refresh, activate }
}
