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
import { loadCocoonWallet, generateCocoonWallet } from './wallet'
import { getStakeInfo, cashout } from './unstake'
import { getStakeCacheStore } from './stake-cache'
import { retireCurrentCocoonWallet } from './retire-wallet'
import { startCocoonManager } from './lifecycle'
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

/**
 * Stake amount used to fund the cocoon_node_wallet before starting the runner.
 * On-chain floor is 15 TON but the canonical Cocoon Lite Client uses 20 TON.
 * Don't lower without explicit confirmation.
 */
const MIN_STAKE_NANO = 20_000_000_000n // 20 TON

/** Extra reserve kept in the native wallet on top of the stake, to cover funding-tx gas. */
const FUND_GAS_RESERVE_NANO = 100_000_000n // 0.1 TON

/** Pause between fund tx and runner start, so the funding tx propagates. */
const FUND_PROPAGATION_MS = 1500

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
export async function flowStake(registry: ServiceRegistry): Promise<{ httpPort: number }> {
  const { cocoonManager } = registry
  const bridge = requireBridge(registry)

  // 1. Inspect current state. wallet may be null on first ever use.
  const currentWallet = await loadCocoonWallet()
  const stakeInfo = currentWallet ? await getStakeInfo(cocoonManager, bridge) : null

  // 2. Idempotent fast path: already active → ensure the runner is up.
  //    Re-clicking Activate while the SC is live must not rotate or spend.
  if (stakeInfo && stakeInfo.status === 'active') {
    log.info('Activate: stake already active, ensuring runner is started')
    await startCocoonManager(cocoonManager)
    return { httpPort: cocoonManager.getHttpPort() }
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
      return { httpPort: cocoonManager.getHttpPort() }
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
  return { httpPort: cocoonManager.getHttpPort() }
}
