/**
 * One-shot Cocoon fund recovery.
 *
 * This is the backend action the settings UI should call. It does not expose
 * wallet secrets to the renderer and it does not treat "cooldown" as the
 * happy path. It tries every immediately actionable recovery first, and only
 * reports a lock when the client SC itself returns a future unlock timestamp.
 */

import { errorMessage } from '../../shared/errors'
import { Address, beginCell } from '@ton/core'
import { createLogger } from '../../shared/logger'
import { getConsumedArchive, type ArchivedCocoon } from './consumed-archive'
import { openBridgeContract } from './contracts/bridge-provider'
import { CocoonClient } from './contracts/wrappers/CocoonClient'
import { buildCocoonWalletInit, sendFromCocoonWallet, sendFromOwnerWallet, type SendResult } from './contracts'
import { getRecoveryQueueStore } from './recovery-queue'
import { getStakeCacheStore } from './stake-cache'
import { getStakeInfo } from './unstake'
import { loadCocoonWallet } from './wallet'
import { DRAIN_DUST_FLOOR_NANO, REFUND_GAS_NANO, narrowClientState } from './constants'
import type { CocoonManager } from './manager'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'
import type { CocoonRecoveryAllResult } from '../../shared/cocoon-types'

const log = createLogger('cocoon:recover-all')

const CONFIRMATION_PAUSE_MS = 2_000

type RecoverableWallet = {
  label: 'current' | 'archive'
  archivedAt?: number
  ownerAddress: string
  nodeAddress: string
  ownerMnemonic: string[]
  nodeSecretBase64: string
  nodePublicKeyHex: string
}

type ClientRecoveryDisposition = {
  safeToDrain: boolean
  pending: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toRecoverableWallet(wallet: NonNullable<Awaited<ReturnType<typeof loadCocoonWallet>>>): RecoverableWallet {
  return {
    label: 'current',
    ownerAddress: wallet.ownerAddress,
    nodeAddress: wallet.nodeAddress,
    ownerMnemonic: wallet.ownerMnemonic,
    nodeSecretBase64: wallet.nodeSecretBase64,
    nodePublicKeyHex: wallet.nodePublicKeyHex,
  }
}

function toRecoverableArchive(archive: ArchivedCocoon): RecoverableWallet {
  return {
    label: 'archive',
    archivedAt: archive.archivedAt,
    ownerAddress: archive.ownerAddress,
    nodeAddress: archive.nodeAddress,
    ownerMnemonic: archive.ownerMnemonic,
    nodeSecretBase64: archive.nodeSecretBase64,
    nodePublicKeyHex: archive.nodePublicKeyHex,
  }
}

function nodeSecret(wallet: RecoverableWallet): Buffer {
  const secret = Buffer.from(wallet.nodeSecretBase64, 'base64')
  if (secret.length !== 32) {
    throw new Error(`Cocoon node secret must be 32 bytes, got ${secret.length}`)
  }
  return secret
}

async function sendClientOpcodeFromNode(
  bridge: WsBridgeClient,
  wallet: RecoverableWallet,
  clientSCAddress: string,
  opcode: number,
  sendExcessesTo: string
): Promise<SendResult> {
  const body = beginCell().storeUint(opcode, 32).storeUint(0, 64).storeAddress(Address.parse(sendExcessesTo)).endCell()

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

async function drainNode(
  bridge: WsBridgeClient,
  wallet: RecoverableWallet,
  destination: string,
  result: CocoonRecoveryAllResult
): Promise<void> {
  const balance = BigInt(await bridge.getBalance(wallet.nodeAddress))
  if (balance <= DRAIN_DUST_FLOOR_NANO) return

  const tx = await sendFromCocoonWallet(
    bridge,
    wallet.nodeAddress,
    nodeSecret(wallet),
    Address.parse(destination),
    0n,
    undefined,
    {
      drainAll: true,
      init: buildCocoonWalletInit(wallet.ownerAddress, wallet.nodePublicKeyHex),
    }
  )
  result.txs.push({
    source: wallet.label === 'archive' ? 'archived-node' : 'current-node',
    address: wallet.nodeAddress,
    amount: balance.toString(),
    bocHash: tx.bocHash,
    archivedAt: wallet.archivedAt,
  })
  result.totalRequested = (BigInt(result.totalRequested) + balance).toString()
}

async function drainOwner(
  bridge: WsBridgeClient,
  wallet: RecoverableWallet,
  destination: string,
  result: CocoonRecoveryAllResult
): Promise<void> {
  const balance = BigInt(await bridge.getBalance(wallet.ownerAddress))
  if (balance <= DRAIN_DUST_FLOOR_NANO) return

  const tx = await sendFromOwnerWallet(bridge, wallet.ownerMnemonic, Address.parse(destination), 0n, undefined, {
    drainAll: true,
  })
  result.txs.push({
    source: wallet.label === 'archive' ? 'archived-owner' : 'current-owner',
    address: wallet.ownerAddress,
    amount: balance.toString(),
    bocHash: tx.bocHash,
    archivedAt: wallet.archivedAt,
  })
  result.totalRequested = (BigInt(result.totalRequested) + balance).toString()
}

async function recoverClient(
  bridge: WsBridgeClient,
  wallet: RecoverableWallet,
  clientSCAddress: string,
  destination: string,
  result: CocoonRecoveryAllResult
): Promise<ClientRecoveryDisposition> {
  let state = await readClientState(bridge, clientSCAddress)
  if (!state) {
    result.skipped.push({
      reason: 'client-unreadable',
      address: clientSCAddress,
      archivedAt: wallet.archivedAt,
    })
    return { safeToDrain: false, pending: false }
  }

  const now = Math.floor(Date.now() / 1000)

  if (state.state === 2) {
    return { safeToDrain: true, pending: false }
  }

  if (state.state === 0) {
    const tx = await sendClientOpcodeFromNode(bridge, wallet, clientSCAddress, 0xfafa6cc1, destination)
    result.txs.push({
      source: 'client-refund-request',
      address: clientSCAddress,
      amount: '0',
      bocHash: tx.bocHash,
      archivedAt: wallet.archivedAt,
    })
    await sleep(CONFIRMATION_PAUSE_MS)
    state = await readClientState(bridge, clientSCAddress)
    if (!state) return { safeToDrain: false, pending: true }
    if (state.state === 0) {
      result.skipped.push({
        reason: 'refund-request-pending-confirmation',
        address: clientSCAddress,
        archivedAt: wallet.archivedAt,
      })
      return { safeToDrain: false, pending: true }
    }
  }

  if (state.state === 1) {
    if (state.unlockTs > now) {
      result.locked.push({
        clientSCAddress,
        unlockTs: state.unlockTs,
        archivedAt: wallet.archivedAt,
      })
      return { safeToDrain: false, pending: true }
    }

    const tx = await sendClientOpcodeFromNode(bridge, wallet, clientSCAddress, 0xfafa6cc1, destination)
    result.txs.push({
      source: 'client-refund-claim',
      address: clientSCAddress,
      amount: '0',
      bocHash: tx.bocHash,
      archivedAt: wallet.archivedAt,
    })
    await sleep(CONFIRMATION_PAUSE_MS)
    state = await readClientState(bridge, clientSCAddress)
    if (!state || state.state !== 2) {
      result.skipped.push({
        reason: 'refund-claim-pending-confirmation',
        address: clientSCAddress,
        archivedAt: wallet.archivedAt,
      })
      return { safeToDrain: false, pending: true }
    }
  }

  return { safeToDrain: true, pending: false }
}

function addClient(
  map: Map<string, { wallet: RecoverableWallet; clientSCAddress: string }>,
  wallet: RecoverableWallet,
  clientSCAddress: string | null | undefined
): void {
  const normalized = clientSCAddress?.trim()
  if (!normalized) return
  map.set(`${wallet.archivedAt ?? 'current'}:${normalized}`, { wallet, clientSCAddress: normalized })
}

export async function recoverAllCocoonFunds(
  manager: CocoonManager,
  bridge: WsBridgeClient,
  destination: string
): Promise<CocoonRecoveryAllResult> {
  const result: CocoonRecoveryAllResult = {
    success: true,
    totalRequested: '0',
    txs: [],
    locked: [],
    skipped: [],
  }

  const clientTargets = new Map<string, { wallet: RecoverableWallet; clientSCAddress: string }>()
  const currentWallet = await loadCocoonWallet()
  const current = currentWallet ? toRecoverableWallet(currentWallet) : null
  const walletsWithClientTargets = new Set<string>()
  const walletsSafeToDrain = new Set<string>()

  const walletKey = (wallet: RecoverableWallet) =>
    wallet.label === 'current' ? 'current' : `archive:${wallet.archivedAt}`

  if (current) {
    const stakeInfo = await getStakeInfo(manager, bridge).catch((err) => {
      log.warn(`current stake info unavailable: ${errorMessage(err)}`)
      return null
    })
    addClient(clientTargets, current, stakeInfo?.clientSCAddress)

    const cache = await getStakeCacheStore().load()
    addClient(clientTargets, current, cache?.clientSCAddress)
  }

  const archives = await getConsumedArchive().list()
  const archivesByTime = new Map(archives.map((entry) => [entry.archivedAt, toRecoverableArchive(entry)]))
  for (const archive of archives) {
    addClient(clientTargets, toRecoverableArchive(archive), archive.lastClientSCAddress)
  }

  for (const queued of await getRecoveryQueueStore().list()) {
    const archive = archivesByTime.get(queued.archivedAt)
    if (archive) addClient(clientTargets, archive, queued.clientSCAddress)
  }

  if (manager.getState().kind !== 'stopped') {
    await manager.stop()
  }

  for (const target of clientTargets.values()) {
    const key = walletKey(target.wallet)
    walletsWithClientTargets.add(key)
    try {
      const disposition = await recoverClient(bridge, target.wallet, target.clientSCAddress, destination, result)
      if (disposition.safeToDrain) {
        walletsSafeToDrain.add(key)
      } else if (target.wallet.label === 'current' && disposition.pending) {
        await getStakeCacheStore().setPendingWithdraw({ startedAt: Date.now() })
      }
    } catch (err) {
      result.skipped.push({
        reason: (err as Error).message ?? 'client recovery failed',
        address: target.clientSCAddress,
        archivedAt: target.wallet.archivedAt,
      })
    }
  }

  if (current) {
    try {
      const key = walletKey(current)
      if (!walletsWithClientTargets.has(key) || walletsSafeToDrain.has(key)) {
        await drainNode(bridge, current, destination, result)
        await drainOwner(bridge, current, destination, result)
      } else {
        result.skipped.push({
          reason: 'current-client-not-closed-wallet-drain-deferred',
          address: current.nodeAddress,
        })
      }
    } catch (err) {
      result.skipped.push({
        reason: (err as Error).message ?? 'current wallet drain failed',
        address: current.nodeAddress,
      })
    }
  }

  for (const archive of archivesByTime.values()) {
    try {
      const key = walletKey(archive)
      if (!walletsWithClientTargets.has(key) || walletsSafeToDrain.has(key)) {
        await drainNode(bridge, archive, destination, result)
        await drainOwner(bridge, archive, destination, result)
      } else {
        result.skipped.push({
          reason: 'archived-client-not-closed-wallet-drain-deferred',
          address: archive.nodeAddress,
          archivedAt: archive.archivedAt,
        })
      }
    } catch (err) {
      result.skipped.push({
        reason: (err as Error).message ?? 'archived wallet drain failed',
        address: archive.nodeAddress,
        archivedAt: archive.archivedAt,
      })
    }
  }

  for (const done of result.txs.filter((tx) => tx.archivedAt !== undefined).map((tx) => tx.archivedAt!)) {
    await getRecoveryQueueStore().update(done, { phase: 'done', sentToMain: destination, lastError: undefined })
  }

  return result
}
