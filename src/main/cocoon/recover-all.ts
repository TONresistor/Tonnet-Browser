/**
 * One-shot Cocoon fund recovery.
 *
 * This is the backend action the settings UI should call. It does not expose
 * wallet secrets to the renderer and it does not treat "cooldown" as the
 * happy path. It tries every immediately actionable recovery first, and only
 * reports a lock when the client SC itself returns a future unlock timestamp.
 */

import { errorMessage } from '../../shared/errors'
import { Address } from '@ton/core'
import { createLogger } from '../../shared/logger'
import type { ArchivedCocoon } from './consumed-archive'
import { buildCocoonWalletInit, sendFromCocoonWallet, sendFromOwnerWallet, type SendResult } from './contracts'
import type { RecoveryEntry } from './recovery-queue'
import { getStakeInfo } from './unstake'
import { loadCocoonWallet } from './wallet'
import { DRAIN_DUST_FLOOR_NANO, REFUND_GAS_NANO } from './constants'
import {
  sleep,
  decodeNodeSecret,
  readClientState,
  buildClientOpcodeBody,
  OWNER_CLIENT_REQUEST_REFUND,
} from './node-signing'
import type { CocoonManager } from './manager'
import type { TonBridgePort } from '../ports/ton-bridge'
import type { CocoonRecoveryAllResult } from '../../shared/cocoon-types'
import type { CocoonPersistence } from './persistence'

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

async function sendClientOpcodeFromNode(
  bridge: TonBridgePort,
  wallet: RecoverableWallet,
  clientSCAddress: string,
  opcode: number,
  sendExcessesTo: string
): Promise<SendResult> {
  const body = buildClientOpcodeBody(opcode, sendExcessesTo)

  return sendFromCocoonWallet(
    bridge,
    wallet.nodeAddress,
    decodeNodeSecret(wallet.nodeSecretBase64),
    Address.parse(clientSCAddress),
    REFUND_GAS_NANO,
    body,
    {
      init: await buildCocoonWalletInit(wallet.ownerAddress, wallet.nodePublicKeyHex),
    }
  )
}

async function drainNode(
  bridge: TonBridgePort,
  wallet: RecoverableWallet,
  destination: string,
  result: CocoonRecoveryAllResult
): Promise<void> {
  const balance = BigInt(await bridge.getBalance(wallet.nodeAddress))
  if (balance <= DRAIN_DUST_FLOOR_NANO) return

  const tx = await sendFromCocoonWallet(
    bridge,
    wallet.nodeAddress,
    decodeNodeSecret(wallet.nodeSecretBase64),
    Address.parse(destination),
    0n,
    undefined,
    {
      drainAll: true,
      init: await buildCocoonWalletInit(wallet.ownerAddress, wallet.nodePublicKeyHex),
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
  bridge: TonBridgePort,
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
  bridge: TonBridgePort,
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
    const tx = await sendClientOpcodeFromNode(bridge, wallet, clientSCAddress, OWNER_CLIENT_REQUEST_REFUND, destination)
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

    const tx = await sendClientOpcodeFromNode(bridge, wallet, clientSCAddress, OWNER_CLIENT_REQUEST_REFUND, destination)
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
  bridge: TonBridgePort,
  destination: string,
  persistence: CocoonPersistence
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
  // archivedAt values whose archived wallet was actually drained to destination
  // this pass. This — not the presence of any tx carrying archivedAt — is the
  // only signal allowed to close a recovery-queue entry (see F1 fund-lock).
  const drainedArchives = new Set<number>()

  const walletKey = (wallet: RecoverableWallet) =>
    wallet.label === 'current' ? 'current' : `archive:${wallet.archivedAt}`

  if (current) {
    const stakeInfo = await getStakeInfo(manager, bridge, persistence.stakeCache).catch((err) => {
      log.warn(`current stake info unavailable: ${errorMessage(err)}`)
      return null
    })
    addClient(clientTargets, current, stakeInfo?.clientSCAddress)

    const cache = await persistence.stakeCache.load()
    addClient(clientTargets, current, cache?.clientSCAddress)
  }

  const archives = await persistence.consumedArchive.list()
  const archivesByTime = new Map(archives.map((entry) => [entry.archivedAt, toRecoverableArchive(entry)]))
  for (const archive of archives) {
    addClient(clientTargets, toRecoverableArchive(archive), archive.lastClientSCAddress)
  }

  for (const queued of await persistence.recoveryQueue.list()) {
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
        await persistence.stakeCache.setPendingWithdraw({ startedAt: Date.now() })
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
        if (archive.archivedAt !== undefined) drainedArchives.add(archive.archivedAt)
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

  for (const { archivedAt, partial } of planRecoveryQueueClosure(
    await persistence.recoveryQueue.list(),
    drainedArchives,
    destination
  )) {
    await persistence.recoveryQueue.update(archivedAt, partial)
  }

  return result
}

/**
 * Decide which recovery-queue entries may be closed ('done') after a one-shot
 * recovery pass.
 *
 * An entry is closed ONLY when its archived wallet was actually drained to
 * `destination` this pass (i.e. its client SC reached state=2 and the node/
 * owner wallets were drained without error). It is NEVER closed on the mere
 * presence of a tx carrying `archivedAt` — recoverClient pushes a
 * `client-refund-request` tx BEFORE the SC has closed, so deriving 'done' from
 * tx presence marked still-locked archives complete, permanently stranding the
 * user's TON on-chain (the RecoveryDriver skips phase==='done') while the UI
 * reported success. Entries still in cooldown/pending are intentionally omitted
 * so the driver keeps working them.
 */
export function planRecoveryQueueClosure(
  queue: readonly Pick<RecoveryEntry, 'archivedAt'>[],
  drainedArchivedAts: ReadonlySet<number>,
  destination: string
): Array<{ archivedAt: number; partial: Partial<RecoveryEntry> }> {
  return queue
    .filter((entry) => drainedArchivedAts.has(entry.archivedAt))
    .map((entry) => ({
      archivedAt: entry.archivedAt,
      partial: { phase: 'done', sentToMain: destination, lastError: undefined },
    }))
}
