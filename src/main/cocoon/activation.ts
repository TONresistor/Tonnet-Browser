/**
 * Cocoon activation / retirement on-chain orchestration.
 *
 * Extracted from the IPC handler so the handlers reduce to validate -> call ->
 * envelope and the multi-step on-chain protocol (drain confirmation, terminal
 * wallet retirement before a fresh setup) is unit-testable in isolation.
 *
 * Preserves the activation invariant: a terminal/consumed identity is only
 * retired (cashout + drain-confirm) when its stake is closed/unknown; a live
 * stake is never rotated out from under its owning node key.
 */
import { errorMessage } from '../../shared/errors'
import { createLogger } from '../../shared/logger'
import { loadCocoonWallet } from './wallet'
import { getStakeInfo, cashout } from './unstake'
import { getStakeCacheStore } from './stake-cache'
import { retireCurrentCocoonWallet } from './retire-wallet'
import type { ServiceRegistry } from '../services'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'

const log = createLogger('cocoon:activation')

/**
 * Floor below which we treat a drained wallet as "empty" (residual gas dust
 * left after a mode 128+32 self-destruct send). 0.1 TON is well above the
 * couple-thousand-nanoTON dust we typically see post-cashout, while staying
 * far below the 20 TON stake so we cannot mistake a still-funded wallet for a
 * drained one.
 */
const DRAIN_FLOOR_NANO = 100_000_000n // 0.1 TON

/** Hard timeout on the post-cashout drain confirmation poll. */
const DRAIN_CONFIRM_TIMEOUT_MS = 60_000

/** Initial interval between balance polls while waiting for the drain to confirm. */
const DRAIN_CONFIRM_POLL_MS = 2000

/** Upper bound for the exponential backoff between drain-confirm polls. */
const DRAIN_CONFIRM_POLL_MAX_MS = 8000

/** Returns the connected bridge client or throws the standard not-initialized error. */
export function requireBridge(registry: ServiceRegistry): WsBridgeClient {
  const bridge = registry.walletManager.getBridgeClient()
  if (!bridge) throw new Error('Bridge not connected — wallet not initialized')
  return bridge
}

/** Returns the native wallet address or throws a not-initialized error naming the action. */
export function requireNativeAddress(registry: ServiceRegistry, action: string): string {
  const native = registry.walletManager.getState().address
  if (!native) throw new Error(`Native wallet not initialized — cannot ${action}`)
  return native
}

/**
 * Poll bridge balances for the cocoon owner+node addresses until both fall
 * below DRAIN_FLOOR_NANO or DRAIN_CONFIRM_TIMEOUT_MS elapses. Throws on
 * timeout; the caller is expected NOT to delete keys in that case so the
 * drain can be retried out-of-band.
 */
async function waitForDrainConfirmed(
  bridge: { getBalance(addr: string): Promise<string> },
  ownerAddress: string,
  nodeAddress: string
): Promise<void> {
  const deadline = Date.now() + DRAIN_CONFIRM_TIMEOUT_MS
  let pollMs = DRAIN_CONFIRM_POLL_MS

  while (true) {
    const [ownerBal, nodeBal] = await Promise.all([
      bridge
        .getBalance(ownerAddress)
        .then((s) => BigInt(s))
        .catch(() => null),
      bridge
        .getBalance(nodeAddress)
        .then((s) => BigInt(s))
        .catch(() => null),
    ])
    if (ownerBal !== null && nodeBal !== null) {
      if (ownerBal < DRAIN_FLOOR_NANO && nodeBal < DRAIN_FLOOR_NANO) {
        log.info(`Activate: drain confirmed (owner=${ownerBal} node=${nodeBal} nanoTON)`)
        return
      }
    }
    if (Date.now() >= deadline) {
      throw new Error('Drain transaction did not confirm within 60s — keys preserved, retry the activation')
    }
    await new Promise<void>((r) => setTimeout(r, pollMs))
    pollMs = Math.min(pollMs * 2, DRAIN_CONFIRM_POLL_MAX_MS)
  }
}

/**
 * Before creating a brand-new Cocoon setup, verify any existing wallet is in a
 * terminal state and sweep its residual balance back to the native wallet.
 * Throws if the existing stake is still live (caller must finish withdrawal).
 */
export async function retireTerminalWalletBeforeCreate(registry: ServiceRegistry): Promise<void> {
  const wallet = await loadCocoonWallet()
  if (!wallet) return

  const bridge = registry.walletManager.getBridgeClient()
  if (!bridge) {
    throw new Error('Existing Cocoon wallet detected — connect the wallet first so terminal state can be verified')
  }

  const stakeInfo = await getStakeInfo(registry.cocoonManager, bridge).catch((err) => {
    log.warn(`walletCreate terminal check: stake info unavailable: ${errorMessage(err)}`)
    return null
  })
  const cache = await getStakeCacheStore().load()

  if (stakeInfo && stakeInfo.status !== 'closed') {
    throw new Error(`Existing Cocoon stake is ${stakeInfo.status}; finish withdrawal before creating a new setup`)
  }
  if (!stakeInfo && cache?.clientSCAddress) {
    throw new Error(
      'Existing Cocoon client contract is cached but unreadable; use recovery before creating a new setup'
    )
  }

  const [ownerBalance, nodeBalance] = await Promise.all([
    bridge
      .getBalance(wallet.ownerAddress)
      .then((s) => BigInt(s))
      .catch(() => 0n),
    bridge
      .getBalance(wallet.nodeAddress)
      .then((s) => BigInt(s))
      .catch(() => 0n),
  ])
  const hasResidual = ownerBalance >= DRAIN_FLOOR_NANO || nodeBalance >= DRAIN_FLOOR_NANO
  if (hasResidual) {
    const native = requireNativeAddress(registry, 'retire existing Cocoon setup')
    try {
      await cashout(registry.cocoonManager, bridge, native)
      await waitForDrainConfirmed(bridge, wallet.ownerAddress, wallet.nodeAddress)
    } catch (err) {
      const msg = errorMessage(err)
      if (!msg.includes('Nothing to cashout')) throw err
    }
  }

  await retireCurrentCocoonWallet('setup-restart')
}
