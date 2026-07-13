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
import { log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
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
import { recoverAllCocoonFunds } from '../../cocoon/recover-all'
import { retireTerminalWalletBeforeCreate, flowStake } from '../../cocoon/activation'
import type { ServiceRegistry } from '../../services'
import type { CocoonLogEvent } from '../../../shared/cocoon-types'
import type { TonBridgePort } from '../../ports/ton-bridge'
import { ipcFailure, ownIpcEmitterListener, secureContractHandle } from '../contract-handler'
import {
  cocoonArchiveExportMnemonicContract,
  cocoonArchiveListContract,
  cocoonAvailabilityContract,
  cocoonCashoutContract,
  cocoonFlowPendingContract,
  cocoonFlowStakeContract,
  cocoonFlowUnstakeContract,
  cocoonFundContract,
  cocoonLogContract,
  cocoonNodeBalanceContract,
  cocoonOwnerBalanceContract,
  cocoonRecoveryAllContract,
  cocoonRecoveryEnqueueContract,
  cocoonRecoveryEventContract,
  cocoonRecoveryListContract,
  cocoonRecoveryRemoveContract,
  cocoonStakeInfoContract,
  cocoonStartContract,
  cocoonStateChangedContract,
  cocoonStatusContract,
  cocoonStopContract,
  cocoonUnstakeContract,
  cocoonWalletCreateContract,
  cocoonWalletDeleteContract,
  cocoonWalletExistsContract,
  cocoonWalletExportMnemonicContract,
  cocoonWalletInfoContract,
  cocoonWalletMarkSetupCompleteContract,
  cocoonWithdrawEventContract,
} from '../../../shared/ipc-contract/cocoon'

export function registerCocoonHandlers(registry: ServiceRegistry): void {
  const { stakeCache, consumedArchive, recoveryQueue } = registry.cocoonPersistence
  const { cocoonManager, withdrawDriver, recoveryDriver, cocoonActivation } = registry

  const requireBridge = (): TonBridgePort => {
    const bridge = registry.walletManager.getTonBridge()
    if (!bridge) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
    return bridge
  }

  const requireNativeAddress = (action: string): string => {
    const native = registry.walletManager.getState().address
    if (!native) throw new Error(`Native wallet not initialized — cannot ${action}`)
    return native
  }

  // ── Push events ────────────────────────────────────────────────────────────

  ownIpcEmitterListener(cocoonManager, 'state-change', (next, prev) => {
    log.debug(`cocoon state ${describe(prev)} -> ${describe(next)}`)
    emitContractToRenderer(cocoonStateChangedContract, next)
  })

  ownIpcEmitterListener(cocoonManager, 'log', (event: CocoonLogEvent) => {
    emitContractToRenderer(cocoonLogContract, event)
  })

  ownIpcEmitterListener(withdrawDriver, 'event', (event: WithdrawDriverEvent) => {
    log.debug(`withdraw event: ${event.type}`)
    emitContractToRenderer(cocoonWithdrawEventContract, event)
  })

  ownIpcEmitterListener(recoveryDriver, 'event', (event: RecoveryDriverEvent) => {
    log.debug(`recovery event: ${event.type} archivedAt=${event.archivedAt}`)
    emitContractToRenderer(cocoonRecoveryEventContract, event)
  })

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  secureContractHandle(cocoonAvailabilityContract, () => {
    return checkCocoonAvailability()
  })

  secureContractHandle(cocoonStatusContract, () => {
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
  secureContractHandle(cocoonStartContract, async () => {
    try {
      await startCocoonManager(cocoonManager)
    } catch (err) {
      const message = errorMessage(err)
      if (message.includes('already starting')) {
        ipcFailure('ALREADY_STARTING', 'Cocoon is already starting', true, err)
      }
      ipcFailure('START_FAILED', 'Operation failed', false, err)
    }
    return { success: true as const, httpPort: cocoonManager.getHttpPort() }
  })

  secureContractHandle(cocoonStopContract, async () => {
    await cocoonManager.stop()
    return { success: true as const }
  })

  // ── Wallet management ───────────────────────────────────────────────────────

  secureContractHandle(cocoonWalletExistsContract, () => hasCocoonWallet())

  secureContractHandle(cocoonWalletCreateContract, async () => {
    if (await hasCocoonWallet()) {
      await retireTerminalWalletBeforeCreate(cocoonActivation)
    }
    const result = await generateCocoonWallet()
    // mnemonic is one-time visible; caller must back it up immediately.
    return { ownerAddress: result.ownerAddress, nodeAddress: result.nodeAddress, mnemonic: result.mnemonic }
  })

  secureContractHandle(cocoonWalletInfoContract, () => getCocoonWalletInfo())

  secureContractHandle(cocoonWalletExportMnemonicContract, () => exportCocoonMnemonic())

  secureContractHandle(cocoonWalletDeleteContract, () => deleteCocoonWallet())

  secureContractHandle(cocoonWalletMarkSetupCompleteContract, async () => {
    try {
      await markSetupComplete()
    } catch (error) {
      ipcFailure('WALLET_WRITE_FAILED', 'Operation failed', false, error)
    }
  })

  // ── Setup wizard ────────────────────────────────────────────────────────────

  secureContractHandle(cocoonOwnerBalanceContract, async () => {
    const bridge = requireBridge()
    try {
      const balance = await getOwnerBalance(bridge)
      return balance.toString() // bigint -> decimal string (IPC-safe)
    } catch (error) {
      ipcFailure('BALANCE_READ_FAILED', 'Operation failed', false, error)
    }
  })

  secureContractHandle(cocoonNodeBalanceContract, async () => {
    const bridge = requireBridge()
    try {
      const balance = await getCocoonWalletBalance(bridge)
      return balance.toString()
    } catch (error) {
      ipcFailure('BALANCE_READ_FAILED', 'Operation failed', false, error)
    }
  })

  secureContractHandle(cocoonFundContract, async ({ amount }) => {
    const bridge = requireBridge()
    try {
      const amountArg: bigint | 'max' = amount === 'max' ? 'max' : BigInt(amount)
      const result = await fundCocoonFromOwner(bridge, amountArg)
      return {
        bocHash: result.bocHash,
        seqno: result.seqno,
        sentAmount: result.sentAmount.toString(), // bigint -> decimal string
      }
    } catch (error) {
      ipcFailure('FUND_FAILED', 'Operation failed', false, error)
    }
  })

  // ── Stake lifecycle (unstake / cashout) ─────────────────────────────────────

  secureContractHandle(cocoonStakeInfoContract, async () => {
    const bridge = requireBridge()
    return getStakeInfo(cocoonManager, bridge, stakeCache)
  })

  secureContractHandle(cocoonUnstakeContract, async () => {
    await unstake(cocoonManager)
    return { success: true as const }
  })

  secureContractHandle(cocoonCashoutContract, async () => {
    const bridge = requireBridge()
    const native = requireNativeAddress('cashout')
    return cashout(cocoonManager, bridge, native)
  })

  // ── Composite flows (single user actions hiding multi-step protocols) ──────

  // Activate Cocoon (rotation semantics + idempotent fast paths). All on-chain
  // orchestration lives in cocoon/activation.ts:flowStake.
  secureContractHandle(cocoonFlowStakeContract, async () => {
    const { httpPort } = await flowStake(cocoonActivation)
    return { success: true as const, httpPort }
  })

  /**
   * Single-click full withdraw: arms the persistent intent flag, sends the
   * on-chain refund request, and lets the WithdrawDriver finish the work
   * (cooldown wait → claim refund → cashout). Returns immediately.
   */
  secureContractHandle(cocoonFlowUnstakeContract, async () => {
    await startFullWithdraw(withdrawDriver, cocoonManager)
    return { success: true as const }
  })

  /** Surface the persistent intent flag so the renderer can render progress. */
  secureContractHandle(cocoonFlowPendingContract, async () => {
    return stakeCache.getPendingWithdraw()
  })

  // ── Consumed-wallet archive ────────────────────────────────────────────────

  /**
   * List archived (consumed) cocoon wallets, oldest first.
   * Returns only public-safe fields — secrets stay on disk encrypted.
   */
  secureContractHandle(cocoonArchiveListContract, async () => {
    const all = await consumedArchive.list()
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
  secureContractHandle(cocoonArchiveExportMnemonicContract, async ({ archivedAt }) => {
    const entry = await consumedArchive.getByArchivedAt(archivedAt)
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
  secureContractHandle(cocoonRecoveryEnqueueContract, async ({ archivedAt, clientSCAddress }) => {
    const archive = await consumedArchive.getByArchivedAt(archivedAt)
    if (!archive) throw new Error('Archive entry not found')

    const bridge = requireBridge()

    const native = requireNativeAddress('enqueue recovery')

    const result = await enqueueRecovery(recoveryDriver, {
      archivedAt,
      clientSCAddress,
      bridge,
      archive,
      nativeAddress: native,
    })
    return { success: true as const, refundBocHash: result.refundBocHash }
  })

  /** Read the recovery queue (oldest first). */
  secureContractHandle(cocoonRecoveryListContract, async () => {
    return recoveryQueue.list()
  })

  /** Manually remove a stuck queue entry. Use with care: stops the driver from working it. */
  secureContractHandle(cocoonRecoveryRemoveContract, async ({ archivedAt }) => {
    await recoveryQueue.remove(archivedAt)
    return { success: true as const }
  })

  /**
   * One-click user recovery. Tries every immediately actionable current and
   * archived Cocoon wallet/client path, and only reports locked funds when the
   * on-chain client SC itself returns a future unlock timestamp.
   */
  secureContractHandle(cocoonRecoveryAllContract, async () => {
    const bridge = requireBridge()
    const native = requireNativeAddress('recover Cocoon funds')
    return recoverAllCocoonFunds(cocoonManager, bridge, native, registry.cocoonPersistence)
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
