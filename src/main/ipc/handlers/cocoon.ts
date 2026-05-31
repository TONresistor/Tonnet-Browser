/**
 * IPC handlers for Cocoon AI:
 *   lifecycle (start / stop / status / push events)
 *   wallet management (exists / create / info / export-mnemonic / delete)
 *   setup wizard  (owner balance + fund)
 *
 * SECURITY: COCOON_START reads all secrets from disk; no sensitive data
 * crosses the IPC boundary in either direction.
 */

import { errorMessage } from '../../../shared/errors'
import { z } from 'zod'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { secureHandle, emitToRenderer, log } from './shared'
import { checkCocoonAvailability } from '../../cocoon/platform'
import {
  hasCocoonWallet,
  generateCocoonWallet,
  getCocoonWalletInfo,
  exportCocoonMnemonic,
  deleteCocoonWallet,
  markSetupComplete,
} from '../../cocoon/wallet'
import { getOwnerBalance, getCocoonWalletBalance, fundCocoonFromOwner } from '../../cocoon/setup'
import { getStakeInfo, unstake, cashout } from '../../cocoon/unstake'
import { startCocoonManager } from '../../cocoon/lifecycle'
import { startFullWithdraw, type WithdrawDriverEvent } from '../../cocoon/withdraw-driver'
import { enqueueRecovery, type RecoveryDriverEvent } from '../../cocoon/recovery-driver'
import { getRecoveryQueueStore } from '../../cocoon/recovery-queue'
import { getStakeCacheStore } from '../../cocoon/stake-cache'
import { getConsumedArchive } from '../../cocoon/consumed-archive'
import { loadCocoonWallet } from '../../cocoon/wallet'
import { recoverAllCocoonFunds } from '../../cocoon/recover-all'
import { retireCurrentCocoonWallet } from '../../cocoon/retire-wallet'
import { requireBridge, requireNativeAddress, retireTerminalWalletBeforeCreate } from '../../cocoon/activation'
import type { ServiceRegistry } from '../../services'
import type { CocoonLogEvent } from '../../../shared/cocoon-types'

/**
 * Stake amount used to fund the cocoon_node_wallet before starting the runner.
 *
 * On-chain floor (min_client_stake from the root SC config) is 15 TON, but
 * the canonical Cocoon Lite Client uses 20 TON as the standard stake — that
 * leaves headroom for tx fees and matches the recovery flows the user has
 * documented. Don't lower without explicit confirmation.
 */
const MIN_STAKE_NANO = 20_000_000_000n // 20 TON

/**
 * Extra reserve kept in the user's native wallet on top of the stake amount,
 * to cover the gas of the funding tx itself (~0.01-0.05 TON in practice) plus
 * a small safety margin so the V5R1 wallet retains funds for future ops.
 */
const FUND_GAS_RESERVE_NANO = 100_000_000n // 0.1 TON

/** Pause between fund tx and runner start, so the funding tx propagates. */
const FUND_PROPAGATION_MS = 1500

// Renderer-supplied IPC param schemas. .parse() throws ZodError, which secureHandle
// wraps into the {success:false,error} envelope.
const FundCocoonParams = z.object({ amount: z.union([z.literal('max'), z.string().regex(/^\d+$/)]) })
const ArchivedAtParams = z.object({ archivedAt: z.number() })
const RecoveryEnqueueParams = z.object({ archivedAt: z.number(), clientSCAddress: z.string().min(1) })

export function registerCocoonHandlers(registry: ServiceRegistry): void {
  const { cocoonManager, withdrawDriver, recoveryDriver } = registry

  // ── Push events ────────────────────────────────────────────────────────────

  cocoonManager.on('state-change', (next, prev) => {
    log.debug(`cocoon state ${describe(prev)} -> ${describe(next)}`)
    emitToRenderer(IPC_CHANNELS.COCOON_STATE_CHANGED, next)
  })

  cocoonManager.on('log', (event: CocoonLogEvent) => {
    emitToRenderer(IPC_CHANNELS.COCOON_LOG, event)
  })

  withdrawDriver.on('event', (event: WithdrawDriverEvent) => {
    log.debug(`withdraw event: ${event.type}`)
    emitToRenderer(IPC_CHANNELS.COCOON_WITHDRAW_EVENT, event)
  })

  recoveryDriver.on('event', (event: RecoveryDriverEvent) => {
    log.debug(`recovery event: ${event.type} archivedAt=${event.archivedAt}`)
    emitToRenderer(IPC_CHANNELS.COCOON_RECOVERY_EVENT, event)
  })

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  secureHandle(IPC_CHANNELS.COCOON_AVAILABILITY, () => {
    return checkCocoonAvailability()
  })

  secureHandle(IPC_CHANNELS.COCOON_STATUS, () => {
    return cocoonManager.getState()
  })

  /**
   * Start the Cocoon client-runner.
   * Reads all required secrets from disk — no params accepted from the renderer.
   *
   * Idempotent on already-ready: if the manager is already in 'ready' state we
   * return success without re-spawning. This matters for the wizard's Retry
   * path when start() succeeded but markSetupComplete failed — the renderer
   * needs to be able to call start() again without hitting "already running".
   */
  secureHandle(IPC_CHANNELS.COCOON_START, async () => {
    try {
      await startCocoonManager(cocoonManager)
    } catch (err) {
      const message = errorMessage(err)
      if (message.includes('already starting')) {
        return { success: false, error: 'Already starting' }
      }
      throw err
    }
    return { success: true, httpPort: cocoonManager.getHttpPort() }
  })

  secureHandle(IPC_CHANNELS.COCOON_STOP, async () => {
    await cocoonManager.stop()
    return { success: true }
  })

  // ── Wallet management ───────────────────────────────────────────────────────

  secureHandle(IPC_CHANNELS.COCOON_WALLET_EXISTS, () => hasCocoonWallet())

  secureHandle(IPC_CHANNELS.COCOON_WALLET_CREATE, async () => {
    if (await hasCocoonWallet()) {
      await retireTerminalWalletBeforeCreate(registry)
    }
    const result = await generateCocoonWallet()
    // mnemonic is one-time visible; caller must back it up immediately.
    return { ownerAddress: result.ownerAddress, nodeAddress: result.nodeAddress, mnemonic: result.mnemonic }
  })

  secureHandle(IPC_CHANNELS.COCOON_WALLET_INFO, () => getCocoonWalletInfo())

  secureHandle(IPC_CHANNELS.COCOON_WALLET_EXPORT_MNEMONIC, () => exportCocoonMnemonic())

  secureHandle(IPC_CHANNELS.COCOON_WALLET_DELETE, () => deleteCocoonWallet())

  secureHandle(IPC_CHANNELS.COCOON_WALLET_MARK_SETUP_COMPLETE, () => markSetupComplete())

  // ── Setup wizard ────────────────────────────────────────────────────────────

  secureHandle(IPC_CHANNELS.COCOON_SETUP_OWNER_BALANCE, async () => {
    const bridge = requireBridge(registry)
    const balance = await getOwnerBalance(bridge)
    return balance.toString() // bigint -> decimal string (IPC-safe)
  })

  secureHandle(IPC_CHANNELS.COCOON_SETUP_COCOON_BALANCE, async () => {
    const bridge = requireBridge(registry)
    const balance = await getCocoonWalletBalance(bridge)
    return balance.toString()
  })

  secureHandle(IPC_CHANNELS.COCOON_SETUP_FUND_COCOON, async (params: unknown) => {
    const { amount } = FundCocoonParams.parse(params)
    const bridge = requireBridge(registry)
    const amountArg: bigint | 'max' = amount === 'max' ? 'max' : BigInt(amount)
    const result = await fundCocoonFromOwner(bridge, amountArg)
    return {
      bocHash: result.bocHash,
      seqno: result.seqno,
      sentAmount: result.sentAmount.toString(), // bigint -> decimal string
    }
  })

  // ── Stake lifecycle (unstake / cashout) ─────────────────────────────────────

  secureHandle(IPC_CHANNELS.COCOON_STAKE_INFO, async () => {
    const bridge = requireBridge(registry)
    return getStakeInfo(cocoonManager, bridge)
  })

  secureHandle(IPC_CHANNELS.COCOON_STAKE_UNSTAKE, async () => {
    await unstake(cocoonManager)
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.COCOON_STAKE_CASHOUT, async () => {
    const bridge = requireBridge(registry)
    const native = requireNativeAddress(registry, 'cashout')
    return cashout(cocoonManager, bridge, native)
  })

  // ── Composite flows (single user actions hiding multi-step protocols) ──────

  /**
   * Activate Cocoon with rotation semantics.
   *
   * The Cocoon proxy worker permanently caches client status per cocoon_node
   * identity (cocoon-v2 ProxyClientInfo.h, sc_status_ field — never
   * auto-refreshes). Re-staking with the same node identity after a withdraw
   * cycle is therefore a dead-end: the worker rejects the new client SC as
   * "consumed" until it is restarted out-of-band. To keep activation a
   * one-click action, every "Activate" call rotates to a FRESH cocoon_node:
   * the prior wallet (mnemonic + node secret) is archived for potential
   * recovery, then a new wallet is generated and funded with 20 TON.
   *
   * Idempotent on already-active stake: if the runner+SC pair are already
   * active we just (re)start the manager and return. No rotation, no spend.
   *
   * Returns once the runner reaches 'ready'.
   */
  secureHandle(IPC_CHANNELS.COCOON_FLOW_STAKE, async () => {
    const bridge = requireBridge(registry)

    // 1. Inspect current state. wallet may be null on first ever use.
    const currentWallet = await loadCocoonWallet()
    const stakeInfo = currentWallet ? await getStakeInfo(cocoonManager, bridge) : null

    // 2. Idempotent fast path: already active → ensure the runner is up.
    //    Re-clicking Activate while the SC is live must not rotate or spend.
    if (stakeInfo && stakeInfo.status === 'active') {
      log.info('Activate: stake already active, ensuring runner is started')
      await startCocoonManager(cocoonManager)
      return { success: true, httpPort: cocoonManager.getHttpPort() }
    }

    // 3. Interrupted-activate recovery fast path. A previous flowStake may
    //    have funded the cocoon_node with 20 TON but crashed before the
    //    runner reached 'ready' (e.g. process killed mid-handshake). The SC
    //    is not yet 'active', but the funds are sitting on-chain on the
    //    fresh node wallet. Rotating now would burn ~0.2 TON and 2 txs to
    //    drain those funds back, regenerate, and re-fund — for nothing.
    //    If the existing node wallet already holds >= MIN_STAKE_NANO, just
    //    start the runner against it and let it complete the registration.
    if (currentWallet) {
      const nodeBalance = BigInt(await bridge.getBalance(currentWallet.nodeAddress))
      if (nodeBalance >= MIN_STAKE_NANO) {
        log.info(`Activate: cocoon_node already funded (${nodeBalance} nanoTON), resuming without rotation`)
        await startCocoonManager(cocoonManager)
        return { success: true, httpPort: cocoonManager.getHttpPort() }
      }
    }

    // Terminal previous cycle: retire the consumed identity and continue with
    // a fresh wallet. Non-terminal states must not rotate, because that would
    // orphan the node key that owns the active/closing client SC.
    if (currentWallet) {
      const stakeCache = await getStakeCacheStore().load()
      const noKnownClient = !stakeInfo && !stakeCache?.clientSCAddress
      if (stakeInfo?.status === 'closed' || noKnownClient) {
        log.info('Activate: retiring terminal Cocoon identity before restake')
        try {
          await cashout(cocoonManager, bridge, registry.walletManager.getState().address || currentWallet.ownerAddress)
        } catch (err) {
          const msg = errorMessage(err)
          if (!msg.includes('Nothing to cashout')) throw err
          log.info('Activate: terminal Cocoon identity has no residual balance to cashout')
        }
        await retireCurrentCocoonWallet('restake')
      } else {
        throw new Error(
          `Cannot activate a new Cocoon stake while previous stake is ${stakeInfo?.status ?? 'unknown'}. Finish withdrawal/recovery first.`
        )
      }
    }

    // 5. Generate a fresh wallet (owner V4R2 + cocoon_node ed25519 pair).
    const fresh = await generateCocoonWallet()

    // 6. Fund 20 TON from the user's native wallet to the fresh cocoon_node.
    const nativeBalance = BigInt(await registry.walletManager.getBalance())
    const required = MIN_STAKE_NANO + FUND_GAS_RESERVE_NANO
    if (nativeBalance < required) {
      throw new Error(`Top up your TON wallet to at least ${required / 1_000_000_000n} TON to activate Cocoon`)
    }

    log.info(`Activate: native wallet → fresh cocoon_node, ${MIN_STAKE_NANO} nanoTON`)
    await registry.walletManager.send(fresh.nodeAddress, MIN_STAKE_NANO.toString())
    await new Promise<void>((r) => setTimeout(r, FUND_PROPAGATION_MS))

    // 7. Start the runner. It registers a new client SC against the fresh node.
    await startCocoonManager(cocoonManager)
    return { success: true, httpPort: cocoonManager.getHttpPort() }
  })

  /**
   * Single-click full withdraw: arms the persistent intent flag, sends the
   * on-chain refund request, and lets the WithdrawDriver finish the work
   * (cooldown wait → claim refund → cashout). Returns immediately.
   */
  secureHandle(IPC_CHANNELS.COCOON_FLOW_UNSTAKE, async () => {
    await startFullWithdraw(withdrawDriver, cocoonManager)
    return { success: true }
  })

  /** Surface the persistent intent flag so the renderer can render progress. */
  secureHandle(IPC_CHANNELS.COCOON_FLOW_PENDING, async () => {
    return getStakeCacheStore().getPendingWithdraw()
  })

  // ── Consumed-wallet archive ────────────────────────────────────────────────

  /**
   * List archived (consumed) cocoon wallets, oldest first.
   * Returns only public-safe fields — secrets stay on disk encrypted.
   */
  secureHandle(IPC_CHANNELS.COCOON_ARCHIVE_LIST, async () => {
    const all = await getConsumedArchive().list()
    return all.map((e) => ({
      archivedAt: e.archivedAt,
      ownerAddress: e.ownerAddress,
      nodeAddress: e.nodeAddress,
      lastClientSCAddress: e.lastClientSCAddress,
    }))
  })

  /**
   * Reveal the mnemonic of an archived wallet for backup / recovery display.
   * Caller is responsible for gating this behind a re-auth prompt.
   */
  secureHandle(IPC_CHANNELS.COCOON_ARCHIVE_EXPORT_MNEMONIC, async (params: unknown) => {
    const { archivedAt } = ArchivedAtParams.parse(params)
    const entry = await getConsumedArchive().getByArchivedAt(archivedAt)
    if (!entry) throw new Error('Archive entry not found')
    return { mnemonic: entry.ownerMnemonic }
  })

  // ── Recovery (drain locked client SCs from archived wallets) ───────────────

  /**
   * Enqueue a recovery for an archived wallet's locked client SC.
   *
   * Sends the initial owner_client_request_refund (op 0xfafa6cc1) signed by
   * the archived owner V4R2 mnemonic, with `sendExcessesTo` pointing at the
   * user's NATIVE main wallet so any surplus is refunded directly there.
   * Persists the entry in the recovery queue and triggers an immediate driver
   * tick. The driver autonomously progresses through cooldown → claim → drain.
   */
  secureHandle(IPC_CHANNELS.COCOON_RECOVERY_ENQUEUE, async (params: unknown) => {
    const { archivedAt, clientSCAddress } = RecoveryEnqueueParams.parse(params)
    const archive = await getConsumedArchive().getByArchivedAt(archivedAt)
    if (!archive) throw new Error('Archive entry not found')

    const bridge = requireBridge(registry)

    const native = requireNativeAddress(registry, 'enqueue recovery')

    const result = await enqueueRecovery(recoveryDriver, {
      archivedAt,
      clientSCAddress,
      bridge,
      archive,
      nativeAddress: native,
    })
    return { success: true, refundBocHash: result.refundBocHash }
  })

  /** Read the recovery queue (oldest first). */
  secureHandle(IPC_CHANNELS.COCOON_RECOVERY_LIST, async () => {
    return getRecoveryQueueStore().list()
  })

  /** Manually remove a stuck queue entry. Use with care: stops the driver from working it. */
  secureHandle(IPC_CHANNELS.COCOON_RECOVERY_REMOVE, async (params: unknown) => {
    const { archivedAt } = ArchivedAtParams.parse(params)
    await getRecoveryQueueStore().remove(archivedAt)
    return { success: true }
  })

  /**
   * One-click user recovery. Tries every immediately actionable current and
   * archived Cocoon wallet/client path, and only reports locked funds when the
   * on-chain client SC itself returns a future unlock timestamp.
   */
  secureHandle(IPC_CHANNELS.COCOON_RECOVERY_ALL, async () => {
    const bridge = requireBridge(registry)
    const native = requireNativeAddress(registry, 'recover Cocoon funds')
    return recoverAllCocoonFunds(cocoonManager, bridge, native)
  })
}

function describe(s: unknown): string {
  if (!s || typeof s !== 'object') return String(s)
  const o = s as Record<string, unknown>
  if (o.kind === 'starting') return `starting:${o.phase}`
  if (o.kind === 'ready') return `ready:${o.httpPort}`
  if (o.kind === 'crashed') return `crashed:${o.error}`
  return String(o.kind)
}
