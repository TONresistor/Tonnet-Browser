/**
 * Runner-independent withdraw driver for the CURRENT Cocoon identity.
 *
 * The client SC owner is the cocoon_node_wallet. When the runner is stuck in
 * startup, we can still progress the on-chain withdraw by signing an external
 * message to the cocoon_node wallet, which sends the refund opcode internally
 * to the client SC. This is also the recovery path when the node wallet was
 * accidentally drained before the client SC closed.
 */

import { errorMessage } from '../../shared/errors'
import { Address, beginCell } from '@ton/core'
import { createLogger } from '../../shared/logger'
import { CocoonClient } from './contracts/wrappers/CocoonClient'
import { openBridgeContract } from './contracts/bridge-provider'
import { buildCocoonWalletInit, sendFromCocoonWallet, type SendResult } from './contracts'
import { getStakeCacheStore } from './stake-cache'
import { getStakeInfo } from './unstake'
import { loadCocoonWallet } from './wallet'
import { REFUND_GAS_NANO, narrowClientState } from './constants'
import type { CocoonManager } from './manager'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'

const log = createLogger('cocoon:current-withdraw')

// cocoon_wallet.fc rejects external messages while my_balance() < 2 TON.
// cocoon_client.fc also requires msg_value >= COMMISSION_ESTIMATE (0.1 TON).
// 2.25 TON is enough to pass the wallet's external gate and forward one
// 0.2 TON refund/claim message (REFUND_GAS_NANO) with fee margin. When topping
// up from a lower balance, fund to 2.4 TON so phase 2 still has room after
// phase 1 fees.
const NODE_GAS_READY_NANO = 2_250_000_000n
const NODE_GAS_TARGET_NANO = 2_400_000_000n
const TOPUP_CONFIRM_TIMEOUT_MS = 60_000
const TOPUP_CONFIRM_POLL_MS = 2_000
const DIRECT_ACTION_CONFIRMATION_WINDOW_MS = 5 * 60_000

type CurrentWallet = NonNullable<Awaited<ReturnType<typeof loadCocoonWallet>>>

export interface CurrentWithdrawResult {
  status: 'requested' | 'awaiting-confirmation' | 'cooldown' | 'claimed' | 'closed'
  clientSCAddress: string
  unlockTs?: number
  bocHash?: string
  toppedUp?: string
}

export type TopUpNodeWallet = (nodeAddress: string, amountNano: bigint) => Promise<void>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nodeSecret(wallet: CurrentWallet): Buffer {
  const secret = Buffer.from(wallet.nodeSecretBase64, 'base64')
  if (secret.length !== 32) {
    throw new Error(`Cocoon node secret must be 32 bytes, got ${secret.length}`)
  }
  return secret
}

async function readClientState(
  bridge: WsBridgeClient,
  clientSCAddress: string
): Promise<{ state: 0 | 1 | 2; unlockTs: number } | null> {
  try {
    const client = CocoonClient.createFromAddress(Address.parse(clientSCAddress))
    const opened = openBridgeContract(bridge, client)
    const data = await opened.getData()
    return { state: narrowClientState(data.state), unlockTs: data.unlockTs }
  } catch (err) {
    log.warn(`client getData failed for ${clientSCAddress.slice(0, 8)}...: ${errorMessage(err)}`)
    return null
  }
}

async function resolveClientSCAddress(manager: CocoonManager, bridge: WsBridgeClient): Promise<string> {
  const info = await getStakeInfo(manager, bridge).catch((err) => {
    log.warn(`stake info unavailable: ${errorMessage(err)}`)
    return null
  })
  if (info?.clientSCAddress) return info.clientSCAddress

  const cache = await getStakeCacheStore().load()
  if (cache?.clientSCAddress) return cache.clientSCAddress

  throw new Error('No Cocoon client contract cached — cannot withdraw current stake')
}

async function ensureNodeGas(
  bridge: WsBridgeClient,
  wallet: CurrentWallet,
  topUpNodeWallet: TopUpNodeWallet | null
): Promise<string | undefined> {
  const balance = BigInt(await bridge.getBalance(wallet.nodeAddress))
  if (balance >= NODE_GAS_READY_NANO) return undefined
  if (!topUpNodeWallet) {
    throw new Error(`Cocoon node wallet needs gas to unlock stake: balance=${balance}, required=${NODE_GAS_READY_NANO}`)
  }

  const topUpAmount = NODE_GAS_TARGET_NANO - balance
  log.warn(`Node wallet gas low (${balance}); topping up ${topUpAmount} nanoTON before withdraw`)
  await topUpNodeWallet(wallet.nodeAddress, topUpAmount)
  await waitForNodeGas(bridge, wallet.nodeAddress)
  return topUpAmount.toString()
}

async function waitForNodeGas(bridge: WsBridgeClient, nodeAddress: string): Promise<void> {
  const deadline = Date.now() + TOPUP_CONFIRM_TIMEOUT_MS

  while (true) {
    const balance = BigInt(await bridge.getBalance(nodeAddress).catch(() => '0'))
    if (balance >= NODE_GAS_READY_NANO) return
    if (Date.now() >= deadline) {
      throw new Error(`Cocoon node gas top-up did not confirm within ${TOPUP_CONFIRM_TIMEOUT_MS / 1000}s`)
    }
    await sleep(TOPUP_CONFIRM_POLL_MS)
  }
}

async function sendRefundFromCurrentNode(
  bridge: WsBridgeClient,
  wallet: CurrentWallet,
  clientSCAddress: string,
  sendExcessesTo: string
): Promise<SendResult> {
  const body = beginCell()
    .storeUint(0xfafa6cc1, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(sendExcessesTo))
    .endCell()

  return sendFromCocoonWallet(
    bridge,
    wallet.nodeAddress,
    nodeSecret(wallet),
    Address.parse(clientSCAddress),
    REFUND_GAS_NANO,
    body,
    {
      init: buildCocoonWalletInit(wallet.ownerAddress, wallet.nodePublicKeyHex),
    }
  )
}

/**
 * Advance the current stake by one deterministic on-chain step.
 *
 * state=0: request refund, entering cooldown.
 * state=1 + future unlockTs: persist pending intent and wait.
 * state=1 + elapsed unlockTs: claim refund, causing the SC to close.
 * state=2: already closed; caller can cashout.
 */
export async function driveCurrentWithdrawStep(params: {
  manager: CocoonManager
  bridge: WsBridgeClient
  nativeAddress: string
  topUpNodeWallet?: TopUpNodeWallet
}): Promise<CurrentWithdrawResult> {
  const { manager, bridge, nativeAddress, topUpNodeWallet } = params
  const wallet = await loadCocoonWallet()
  if (!wallet) throw new Error('Cocoon wallet not initialized')

  if (manager.getState().kind !== 'stopped') {
    log.info('Stopping runner before direct current-stake withdraw step')
    await manager.stop()
  }

  const clientSCAddress = await resolveClientSCAddress(manager, bridge)
  const state = await readClientState(bridge, clientSCAddress)
  if (!state) {
    throw new Error(`Unable to read Cocoon client contract ${clientSCAddress}`)
  }

  if (state.state === 2) {
    return { status: 'closed', clientSCAddress }
  }

  const cache = await getStakeCacheStore().load()
  const pending = cache?.pendingWithdraw ?? { startedAt: Date.now() }
  await getStakeCacheStore().setPendingWithdraw(pending)

  if (state.state === 1) {
    const now = Math.floor(Date.now() / 1000)
    if (state.unlockTs > now) {
      return { status: 'cooldown', clientSCAddress, unlockTs: state.unlockTs }
    }
  }

  const nowMs = Date.now()
  if (pending.lastActionAt && nowMs - pending.lastActionAt < DIRECT_ACTION_CONFIRMATION_WINDOW_MS) {
    return {
      status: 'awaiting-confirmation',
      clientSCAddress,
      unlockTs: state.unlockTs || undefined,
      bocHash: pending.lastBocHash,
    }
  }

  const toppedUp = await ensureNodeGas(bridge, wallet, topUpNodeWallet ?? null)
  const tx = await sendRefundFromCurrentNode(bridge, wallet, clientSCAddress, nativeAddress)
  await getStakeCacheStore().setPendingWithdraw({
    ...pending,
    lastActionAt: nowMs,
    lastBocHash: tx.bocHash,
  })
  return {
    status: state.state === 0 ? 'requested' : 'claimed',
    clientSCAddress,
    unlockTs: state.unlockTs || undefined,
    bocHash: tx.bocHash,
    toppedUp,
  }
}
