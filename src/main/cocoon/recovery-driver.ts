/**
 * Background driver that auto-progresses recovery intents for ARCHIVED
 * Cocoon wallets whose client SC still locks user TON.
 *
 * This is a parallel system to WithdrawDriver: that one operates on the
 * currently-active wallet via the runner. This one operates on rotated-out
 * wallets entirely off-runner — every tx is signed locally with archived
 * material (owner V4R2 mnemonic + cocoon_node ed25519 seed), and on-chain
 * state is read directly via the WS bridge.
 *
 * State machine per entry (advances at most one phase per tick):
 *
 *   refund-pending → cooldown
 *     The enqueue handler already broadcast the initial request_refund. The
 *     SC should be in state=1 with unlock_ts set; we read getData to confirm
 *     and pin unlockTs onto the entry. If the SC is still in state=0 we
 *     re-broadcast the refund (transient bridge errors during enqueue would
 *     leave us here).
 *
 *   cooldown → claim-pending
 *     When now() >= unlock_ts, we transition. Driving the claim happens in
 *     the next tick to keep each tick atomic / debug-friendly.
 *
 *   claim-pending → drain-pending
 *     Send request_refund AGAIN. The on-chain handler interprets a refund
 *     request on (state=1, now>=unlock_ts) as the claim: stake forwarded to
 *     cocoon_node, SC self-destructs to state=2.
 *
 *   drain-pending → done
 *     Read cocoon_node balance via the bridge. If above the dust floor,
 *     drain it to the user's NATIVE wallet using sendFromCocoonWallet with
 *     drainAll mode (CARRY_ALL_REMAINING_BALANCE + DESTROY_ACCOUNT_IF_ZERO).
 *
 *   * → failed
 *     Reserved for unrecoverable on-chain errors; transient bridge errors
 *     keep the entry in its current phase and retry next tick.
 *
 * Crash-safe: queue lives in cocoon-recovery-queue.dat (encrypted, atomic
 * write). Closing the app during a 60-day cooldown loses nothing — next
 * start picks the entry up exactly where it was.
 */

import { errorMessage } from '../../shared/errors'
import { EventEmitter } from 'events'
import { Address, beginCell } from '@ton/core'
import { createLogger } from '../../shared/logger'
import { getRecoveryQueueStore, type RecoveryEntry } from './recovery-queue'
import { getConsumedArchive, type ArchivedCocoon } from './consumed-archive'
import { CocoonClient } from './contracts/wrappers/CocoonClient'
import { openBridgeContract } from './contracts/bridge-provider'
import { sendFromCocoonWallet, buildCocoonWalletInit } from './contracts'
import { DRAIN_DUST_FLOOR_NANO, REFUND_GAS_NANO, narrowClientState } from './constants'
import type { WsBridgeClient } from '../wallet/ws-bridge-client'
import type { RecoveryDriverEvent } from '../../shared/cocoon-types'

/**
 * The client SC's owner is the cocoon_node_wallet (Ed25519 SC), not the V4R2.
 * `op::owner_client_request_refund` (0xfafa6cc1) must therefore arrive as an
 * INTERNAL message FROM the node wallet — which means we sign an EXTERNAL
 * message to the node wallet (with its 32-byte secret), carrying the refund
 * opcode as the inner body. The V4R2 mnemonic alone cannot trigger the SC.
 */
async function sendRefundFromNode(
  bridge: WsBridgeClient,
  archive: ArchivedCocoon,
  clientSCAddress: string,
  sendExcessesTo: string
): Promise<{ bocHash: string; seqno: number }> {
  const nodeSecret = Buffer.from(archive.nodeSecretBase64, 'base64')
  if (nodeSecret.length !== 32) {
    throw new Error(`Archived node secret must be 32 bytes, got ${nodeSecret.length}`)
  }
  const refundBody = beginCell()
    .storeUint(0xfafa6cc1, 32) // op::owner_client_request_refund
    .storeUint(0, 64) // query_id
    .storeAddress(Address.parse(sendExcessesTo))
    .endCell()
  return sendFromCocoonWallet(
    bridge,
    archive.nodeAddress,
    nodeSecret,
    Address.parse(clientSCAddress),
    REFUND_GAS_NANO,
    refundBody,
    {
      init: buildCocoonWalletInit(archive.ownerAddress, archive.nodePublicKeyHex),
    }
  )
}

const log = createLogger('cocoon:recovery-driver')

/** Idle poll cadence. Matches the WithdrawDriver cadence so observable behavior is consistent. */
const TICK_INTERVAL_MS = 60_000

export type { RecoveryDriverEvent }

export class RecoveryDriver extends EventEmitter {
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight = false

  constructor(
    private getBridge: () => WsBridgeClient | null,
    private getNativeAddress: () => string | null
  ) {
    super()
  }

  /** Start the periodic ticker. Idempotent. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.warn(`tick error: ${errorMessage(err)}`))
    }, TICK_INTERVAL_MS)
    setImmediate(() => {
      this.tick().catch((err) => log.warn(`initial tick error: ${errorMessage(err)}`))
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Trigger an immediate tick (used right after enqueue). */
  triggerTick(): void {
    setImmediate(() => {
      this.tick().catch((err) => log.warn(`triggered tick error: ${errorMessage(err)}`))
    })
  }

  private async tick(): Promise<void> {
    if (this.inflight) return
    const queue = await getRecoveryQueueStore().list()
    if (queue.length === 0) return

    const bridge = this.getBridge()
    if (!bridge) return // bridge offline, retry next tick

    this.inflight = true
    try {
      for (const entry of queue) {
        if (entry.phase === 'done' || entry.phase === 'failed') continue
        try {
          await this.advanceEntry(entry, bridge)
        } catch (err) {
          // Transient: log, persist lastError, keep phase. Next tick retries.
          const message = errorMessage(err)
          log.warn(`Recovery tick failed for archivedAt=${entry.archivedAt}: ${message}`)
          await getRecoveryQueueStore().update(entry.archivedAt, { lastError: message })
        }
      }
    } finally {
      this.inflight = false
    }
  }

  private async advanceEntry(entry: RecoveryEntry, bridge: WsBridgeClient): Promise<void> {
    const archive = await getConsumedArchive().getByArchivedAt(entry.archivedAt)
    if (!archive) {
      // The archive entry was deleted out from under us. Mark failed so we
      // stop polling, but don't drop the queue entry (user may want to
      // inspect it manually).
      await this.markFailed(entry, 'Archive entry not found — cannot recover without secrets')
      return
    }

    switch (entry.phase) {
      case 'refund-pending':
      case 'cooldown':
        await this.driveCooldown(entry, archive, bridge)
        return
      case 'claim-pending':
        await this.driveClaim(entry, archive, bridge)
        return
      case 'drain-pending':
        await this.driveDrain(entry, archive, bridge)
        return
    }
  }

  /**
   * Inspect on-chain state. If state=0 (somehow still active), re-send the
   * refund. If state=1 (closing), record unlock_ts; if elapsed → claim-pending.
   * If state=2 (already closed), funds are sitting on cocoon_node → drain.
   */
  private async driveCooldown(entry: RecoveryEntry, archive: ArchivedCocoon, bridge: WsBridgeClient): Promise<void> {
    const client = CocoonClient.createFromAddress(Address.parse(entry.clientSCAddress))
    const opened = openBridgeContract(bridge, client)

    let onchain
    try {
      onchain = await opened.getData()
    } catch (err) {
      // SC not deployed / not initialized — could mean the initial deploy
      // never confirmed or the SC self-destructed already. If we have no
      // unlockTs recorded, retry the initial refund.
      log.warn(`getData failed for ${entry.clientSCAddress.slice(0, 8)}…: ${errorMessage(err)}`)
      throw err
    }

    const state = narrowClientState(onchain.state)
    const unlockTs = onchain.unlockTs

    if (state === 0) {
      log.info(`Recovery ${entry.archivedAt}: SC still active, re-sending request_refund (node-signed)`)
      const native = this.getNativeAddress()
      if (!native) throw new Error('Native wallet not initialized — cannot set excess address')
      const result = await sendRefundFromNode(bridge, archive, entry.clientSCAddress, native)
      await getRecoveryQueueStore().update(entry.archivedAt, {
        phase: 'cooldown',
        refundBocHash: result.bocHash,
        lastError: undefined,
      })
      return
    }

    if (state === 1) {
      const now = Math.floor(Date.now() / 1000)
      if (now < unlockTs) {
        // Still in cooldown. Pin the unlock_ts on the entry so the renderer
        // can render an ETA without an extra round-trip.
        if (entry.unlockTs !== unlockTs) {
          await getRecoveryQueueStore().update(entry.archivedAt, {
            phase: 'cooldown',
            unlockTs,
            lastError: undefined,
          })
          this.emit('event', {
            type: 'cooldown',
            archivedAt: entry.archivedAt,
            clientSCAddress: entry.clientSCAddress,
            unlockTs,
          } satisfies RecoveryDriverEvent)
        }
        return
      }
      // Cooldown elapsed — promote to claim.
      await getRecoveryQueueStore().update(entry.archivedAt, {
        phase: 'claim-pending',
        unlockTs,
        lastError: undefined,
      })
      return
    }

    // state === 2 → SC self-destructed already. Funds are on cocoon_node.
    await getRecoveryQueueStore().update(entry.archivedAt, {
      phase: 'drain-pending',
      lastError: undefined,
    })
  }

  /**
   * Send the second request_refund. On (state=1, now>=unlock_ts), the SC's
   * handler treats this as the claim: stake forwarded to cocoon_node, SC
   * destroyed. Next tick observes state=2 and transitions to drain.
   */
  private async driveClaim(entry: RecoveryEntry, archive: ArchivedCocoon, bridge: WsBridgeClient): Promise<void> {
    const native = this.getNativeAddress()
    if (!native) throw new Error('Native wallet not initialized — cannot set excess address')

    log.info(`Recovery ${entry.archivedAt}: claiming refund (second request_refund, node-signed)`)
    const result = await sendRefundFromNode(bridge, archive, entry.clientSCAddress, native)
    await getRecoveryQueueStore().update(entry.archivedAt, {
      phase: 'drain-pending',
      claimBocHash: result.bocHash,
      lastError: undefined,
    })
    this.emit('event', {
      type: 'claimed',
      archivedAt: entry.archivedAt,
      clientSCAddress: entry.clientSCAddress,
      bocHash: result.bocHash,
    } satisfies RecoveryDriverEvent)
  }

  /**
   * Drain the cocoon_node wallet to the user's native wallet, then mark done.
   * Uses drainAll (mode 128+32) so the cocoon_wallet SC self-destructs and
   * forwards every nanoTON.
   */
  private async driveDrain(entry: RecoveryEntry, archive: ArchivedCocoon, bridge: WsBridgeClient): Promise<void> {
    const native = this.getNativeAddress()
    if (!native) throw new Error('Native wallet not initialized — cannot determine drain destination')

    const balance = BigInt(await bridge.getBalance(archive.nodeAddress))
    if (balance < DRAIN_DUST_FLOOR_NANO) {
      log.info(`Recovery ${entry.archivedAt}: cocoon_node residual ${balance} < dust floor — marking done`)
      await getRecoveryQueueStore().update(entry.archivedAt, {
        phase: 'done',
        sentToMain: native,
        lastError: undefined,
      })
      this.emit('event', {
        type: 'done',
        archivedAt: entry.archivedAt,
        clientSCAddress: entry.clientSCAddress,
      } satisfies RecoveryDriverEvent)
      return
    }

    log.info(`Recovery ${entry.archivedAt}: draining cocoon_node ${balance} nanoTON → ${native.slice(0, 8)}…`)
    const nodeSecret = Buffer.from(archive.nodeSecretBase64, 'base64')
    if (nodeSecret.length !== 32) {
      throw new Error(`Archived node secret must be 32 bytes, got ${nodeSecret.length}`)
    }
    const result = await sendFromCocoonWallet(
      bridge,
      archive.nodeAddress,
      nodeSecret,
      Address.parse(native),
      0n,
      undefined,
      {
        drainAll: true,
        init: buildCocoonWalletInit(archive.ownerAddress, archive.nodePublicKeyHex),
      }
    )
    await getRecoveryQueueStore().update(entry.archivedAt, {
      phase: 'done',
      drainBocHash: result.bocHash,
      sentToMain: native,
      lastError: undefined,
    })
    this.emit('event', {
      type: 'drained',
      archivedAt: entry.archivedAt,
      clientSCAddress: entry.clientSCAddress,
      bocHash: result.bocHash,
      sentAmount: balance.toString(),
      sentTo: native,
    } satisfies RecoveryDriverEvent)
    this.emit('event', {
      type: 'done',
      archivedAt: entry.archivedAt,
      clientSCAddress: entry.clientSCAddress,
    } satisfies RecoveryDriverEvent)
  }

  private async markFailed(entry: RecoveryEntry, message: string): Promise<void> {
    await getRecoveryQueueStore().update(entry.archivedAt, {
      phase: 'failed',
      lastError: message,
    })
    this.emit('event', {
      type: 'failed',
      archivedAt: entry.archivedAt,
      clientSCAddress: entry.clientSCAddress,
      message,
    } satisfies RecoveryDriverEvent)
  }
}

/**
 * IPC entry-point helper: enqueue a recovery for an archived wallet, send the
 * initial request_refund tx, and trigger an immediate driver tick. Returns
 * the boc hash so the caller can surface it in the UI.
 *
 * The caller MUST have already verified the archive entry exists.
 */
export interface EnqueueRecoveryParams {
  archivedAt: number
  clientSCAddress: string
  bridge: WsBridgeClient
  archive: ArchivedCocoon
  /** Native wallet address — used as `sendExcessesTo` for the refund tx. */
  nativeAddress: string
}

export async function enqueueRecovery(
  driver: RecoveryDriver,
  params: EnqueueRecoveryParams
): Promise<{ refundBocHash: string }> {
  const { archivedAt, clientSCAddress, bridge, archive, nativeAddress } = params
  // Send the initial request_refund signed by the cocoon_node_wallet (the SC's
  // actual on-chain owner). Do not assume the next state; the driver must read
  // the SC before showing any locked/cooldown state to the user.
  const result = await sendRefundFromNode(bridge, archive, clientSCAddress, nativeAddress)

  await getRecoveryQueueStore().add({
    archivedAt,
    clientSCAddress,
    phase: 'refund-pending',
    addedAt: Date.now(),
    refundBocHash: result.bocHash,
  })

  driver.emit('event', {
    type: 'started',
    archivedAt,
    clientSCAddress,
  } satisfies RecoveryDriverEvent)
  driver.triggerTick()

  return { refundBocHash: result.bocHash }
}
