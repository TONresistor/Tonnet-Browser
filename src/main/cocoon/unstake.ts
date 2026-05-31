/**
 * Cocoon stake lifecycle orchestrator.
 *
 * Combines three data sources to give the renderer a single coherent
 * snapshot of the staking state:
 *
 *   1. Runner /jsonstats        — proxy and client SC addresses, runner-side state
 *   2. CocoonClient.getData()   — authoritative on-chain state (unlock_ts, balance, stake)
 *   3. WsBridge.getBalance()    — residual TON in the cocoon node wallet
 *
 * The renderer never sees the cocoon node wallet secret nor signs anything;
 * the runner does the request_refund/withdraw on-chain, and we sign the final
 * cashout (cocoon → owner) with the persisted node secret.
 */

import { errorMessage } from '../../shared/errors'
import { Address } from '@ton/core'
import { createLogger } from '../../shared/logger'
import { fetchJsonStats, requestRefund as runnerClose } from './runner-api'
import { CocoonClient } from './contracts/wrappers/CocoonClient'
import { openBridgeContract } from './contracts/bridge-provider'
import { sendFromCocoonWallet, sendFromOwnerWallet, buildCocoonWalletInit } from './contracts'
import { loadCocoonWallet, getNodeSecretBuffer } from './wallet'
import { getStakeCacheStore } from './stake-cache'
import { DRAIN_DUST_FLOOR_NANO } from './constants'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'
import type { CocoonManager } from './manager'
import type { CocoonStakeInfo, CocoonStakeStatus } from '../../shared/cocoon-types'

const log = createLogger('cocoon:unstake')

/**
 * Build a full stake snapshot.
 *
 * Two paths:
 *  1. Runner is ready → query /jsonstats for the live proxy + state, refresh
 *     the persistent cache, then read the client SC on-chain to enrich.
 *  2. Runner is stopped/crashed → fall back to the persistent cache (filled
 *     on a previous successful run) and read on-chain. Lets the UI display
 *     stake state and offer cashout even when the runner is offline.
 *
 * Returns null only when:
 *   - the runner has never registered a client SC (no cache, no jsonstats)
 *   - both paths failed transiently
 *
 * Source of `runnerState`:
 *   - When live: from /jsonstats `proxies[0].state` (matches the runner's view).
 *   - When cached/offline: defaults to the on-chain state (no live runner view).
 */
export async function getStakeInfo(manager: CocoonManager, bridge: WsBridgeClient): Promise<CocoonStakeInfo | null> {
  const wallet = await loadCocoonWallet()
  const managerState = manager.getState()
  const runnerStatus = managerState.kind

  // Live path: runner ready, jsonstats available
  if (managerState.kind === 'ready') {
    try {
      const stats = await fetchJsonStats(manager.getHttpPort())
      const proxy = stats.proxies[0]
      if (proxy) {
        // Refresh the cache for offline reads later. Don't await — fire and
        // forget; persistence shouldn't block the UI poll.
        if (wallet) {
          getStakeCacheStore()
            .saveStakeAddresses({
              proxySCAddress: proxy.proxy_sc_address,
              clientSCAddress: proxy.sc_address,
              ownerAddress: wallet.ownerAddress,
              cachedAt: Date.now(),
            })
            .catch((e) => log.warn(`stake cache save failed: ${errorMessage(e)}`))
        }
        return await buildSnapshot({
          bridge,
          wallet,
          proxySCAddress: proxy.proxy_sc_address,
          clientSCAddress: proxy.sc_address,
          runnerStateOverride: proxy.state,
          tokensCharged: proxy.tokens_charged,
          tokensPayed: proxy.tokens_payed,
          runnerStatus,
        })
      }
    } catch (err) {
      log.warn(`fetchJsonStats failed: ${errorMessage(err)}`)
      // Fall through to cache path.
    }
  }

  // Offline path: read from cache + on-chain. Need both SC addresses, otherwise
  // we have nothing to query. A cache holding only `pendingWithdraw` is valid
  // pre-stake state and reports as null here.
  const cache = await getStakeCacheStore().load()
  if (!cache?.proxySCAddress || !cache.clientSCAddress) return null

  return buildSnapshot({
    bridge,
    wallet,
    proxySCAddress: cache.proxySCAddress,
    clientSCAddress: cache.clientSCAddress,
    runnerStateOverride: null,
    tokensCharged: 0,
    tokensPayed: 0,
    runnerStatus,
  })
}

interface SnapshotArgs {
  bridge: WsBridgeClient
  wallet: { nodeAddress: string } | null
  proxySCAddress: string
  clientSCAddress: string
  /** Runner-reported on-chain state (when live). null when reading from cache. */
  runnerStateOverride: 0 | 1 | 2 | null
  tokensCharged: number
  tokensPayed: number
  runnerStatus: 'stopped' | 'starting' | 'ready' | 'crashed'
}

async function buildSnapshot(args: SnapshotArgs): Promise<CocoonStakeInfo> {
  const {
    bridge,
    wallet,
    proxySCAddress,
    clientSCAddress,
    runnerStateOverride,
    tokensCharged,
    tokensPayed,
    runnerStatus,
  } = args
  const client = CocoonClient.createFromAddress(Address.parse(clientSCAddress))
  const opened = openBridgeContract(bridge, client)

  let onchain
  try {
    onchain = await opened.getData()
  } catch (err) {
    // Client SC not deployed yet, or read failed. Surface a partial snapshot
    // using whichever runner state we have (or 0 if cache only).
    log.warn(`Client SC getData failed: ${errorMessage(err)}`)
    const fallbackRunnerState = runnerStateOverride ?? 0
    return {
      status: deriveStatus(fallbackRunnerState, 0),
      proxySCAddress,
      clientSCAddress,
      runnerState: fallbackRunnerState,
      onchainState: null,
      balance: '0',
      stake: '0',
      unlockTs: 0,
      tokensUsed: tokensCharged.toString(),
      tokensPayed: tokensPayed.toString(),
      cocoonWalletBalance: '0',
      runnerStatus,
    }
  }

  const cocoonBalance = wallet ? BigInt(await bridge.getBalance(wallet.nodeAddress)) : 0n
  const onchainState = onchain.state as 0 | 1 | 2
  // When reading from cache, use on-chain state as the runner state proxy.
  const runnerState = runnerStateOverride ?? onchainState

  return {
    status: deriveStatus(runnerState, onchainState, onchain.unlockTs),
    proxySCAddress,
    clientSCAddress,
    runnerState,
    onchainState,
    balance: onchain.balance.toString(),
    stake: onchain.stake.toString(),
    unlockTs: onchain.unlockTs,
    tokensUsed: onchain.tokensUsed.toString(),
    tokensPayed: tokensPayed.toString(),
    cocoonWalletBalance: cocoonBalance.toString(),
    runnerStatus,
  }
}

/**
 * Derive a UI-friendly status string from the runner state and on-chain state.
 * Falls back to runner state when the on-chain read failed (rare).
 */
function deriveStatus(runnerState: 0 | 1 | 2, onchainState: 0 | 1 | 2, unlockTs: number = 0): CocoonStakeStatus {
  // Runner is the source of truth for "transitioning" — its sc_state lags slightly
  // behind exp_sc_state during a request, but for the closed/closing distinction
  // they converge once the tx confirms. Prefer the higher of the two so the UI
  // never goes backwards.
  const state = Math.max(runnerState, onchainState) as 0 | 1 | 2
  if (state === 0) return 'active'
  if (state === 1) {
    if (unlockTs === 0) return 'closing'
    if (Math.floor(Date.now() / 1000) >= unlockTs) return 'refundable'
    return 'cooldown'
  }
  return 'closed'
}

/**
 * Trigger the on-chain unstake step.
 *
 * Requires the runner to be ready: only the runner can sign request_refund
 * with the cocoon node wallet (the SC's owner_address). If the runner is
 * stopped, surface a clear error so the UI can prompt to restart it.
 *
 * In state=active: starts the cooldown (state becomes closing, unlock_ts set,
 *   surplus refunded immediately).
 * In state=refundable: completes the unstake (state becomes closed, the staked
 *   amount is forwarded back to the cocoon wallet).
 *
 * Throws when called in state=closing (cooldown not elapsed) or state=closed.
 */
export async function unstake(manager: CocoonManager): Promise<void> {
  const state = manager.getState()
  if (state.kind !== 'ready') {
    throw new Error('Runner must be running to unstake — start Cocoon first')
  }

  const stats = await fetchJsonStats(manager.getHttpPort())
  const proxy = stats.proxies[0]
  if (!proxy) {
    throw new Error('No proxy registered — nothing to unstake')
  }

  log.info(`Unstake: proxy=${proxy.proxy_sc_address.slice(0, 8)}… runnerState=${proxy.state}`)
  await runnerClose(manager.getHttpPort(), proxy.proxy_sc_address)
}

/**
 * Drain ALL residual cocoon-controlled balances back to the user's native
 * wallet. Two sweeps are performed sequentially:
 *
 *   1. cocoon_node_wallet (Ed25519 SC) → destination
 *      Always present; signs with the persisted node secret.
 *
 *   2. cocoon owner V4R2 → destination (legacy sweep)
 *      Holds residuals from older flows where funds were routed through it.
 *      Skipped silently when the balance is below the gas reserve.
 *
 * The runner is stopped first so the cocoon node wallet's seqno is no longer
 * being incremented by the runner mid-sweep.
 *
 * Returns the total amount swept and an array of individual tx receipts.
 */
export async function cashout(
  manager: CocoonManager,
  bridge: WsBridgeClient,
  destination: string
): Promise<{
  totalSent: string
  txs: Array<{ source: 'node' | 'owner'; bocHash: string; sentAmount: string }>
}> {
  const wallet = await loadCocoonWallet()
  if (!wallet) throw new Error('Cocoon wallet not initialized')

  if (manager.getState().kind !== 'stopped') {
    log.info('Cashout: stopping runner before sweeping cocoon-controlled wallets')
    await manager.stop()
  }

  const dest = Address.parse(destination)
  const txs: Array<{ source: 'node' | 'owner'; bocHash: string; sentAmount: string }> = []
  let total = 0n

  // 1. Drain cocoon_node_wallet to zero (mode 128+32 self-destructs the SC).
  //    No reserve kept — the user wants every nanoTON back when they withdraw.
  //    The init is attached so an uninit cocoon_wallet (TON arrived but code
  //    never deployed) gets deployed by this very tx and then drained.
  const nodeBalance = BigInt(await bridge.getBalance(wallet.nodeAddress))
  if (nodeBalance > DRAIN_DUST_FLOOR_NANO) {
    log.info(`Cashout step 1: cocoon_node_wallet → native, draining ${nodeBalance} nanoTON (mode 128+32)`)
    const nodeSecret = await getNodeSecretBuffer()
    const result = await sendFromCocoonWallet(bridge, wallet.nodeAddress, nodeSecret, dest, 0n, undefined, {
      drainAll: true,
      init: buildCocoonWalletInit(wallet.ownerAddress, wallet.nodePublicKeyHex),
    })
    txs.push({ source: 'node', bocHash: result.bocHash, sentAmount: nodeBalance.toString() })
    total += nodeBalance
  } else {
    log.info(`Cashout step 1: cocoon_node_wallet residual ${nodeBalance} below floor, skipped`)
  }

  // 2. Drain legacy cocoon owner V4R2 to zero and self-destruct it on the chain.
  //    The mode 128+32 transfer keeps no reserve — perfect for a final sweep
  //    where we don't intend to reuse this wallet.
  const ownerBalance = BigInt(await bridge.getBalance(wallet.ownerAddress))
  if (ownerBalance > DRAIN_DUST_FLOOR_NANO) {
    log.info(`Cashout step 2 (legacy): cocoon owner → native, draining ${ownerBalance} nanoTON (mode 128+32)`)
    const result = await sendFromOwnerWallet(bridge, wallet.ownerMnemonic, dest, 0n, undefined, { drainAll: true })
    // We send exactly ownerBalance minus chain-side gas; surface the pre-fee
    // figure for the receipt so the UI total matches what the user saw before.
    txs.push({ source: 'owner', bocHash: result.bocHash, sentAmount: ownerBalance.toString() })
    total += ownerBalance
  } else {
    log.info(`Cashout step 2 (legacy): cocoon owner residual ${ownerBalance} below floor, skipped`)
  }

  if (total === 0n) {
    throw new Error('Nothing to cashout — all cocoon-controlled balances are below the drain floor')
  }

  return { totalSent: total.toString(), txs }
}
