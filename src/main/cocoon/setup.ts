/**
 * Cocoon setup orchestrator.
 *
 * Provides helpers for the setup wizard:
 *   - getOwnerBalance: query the owner wallet's current balance via the bridge.
 *   - fundCocoonFromOwner: transfer TON from the owner wallet to the cocoon
 *     node wallet, keeping a gas reserve in the owner wallet.
 *
 * Both functions read secrets from disk (via loadCocoonWallet) and never
 * expose them across the IPC boundary.
 */

import { Address } from '@ton/core'
import { loadCocoonWallet } from './wallet'
import { sendFromOwnerWallet } from './contracts'
import type { TonBridgePort } from '../ports/ton-bridge'
import { createLogger } from '../../shared/logger'

const log = createLogger('cocoon:setup')

/** Minimum amount kept in the owner wallet after auto-funding (0.5 TON). */
const OWNER_GAS_RESERVE = 500_000_000n

/**
 * Return the current nano-TON balance of the owner wallet.
 * Throws if no Cocoon wallet has been generated yet.
 */
export async function getOwnerBalance(bridge: TonBridgePort): Promise<bigint> {
  const data = await loadCocoonWallet()
  if (!data) throw new Error('Cocoon wallet not initialized')
  return BigInt(await bridge.getBalance(data.ownerAddress))
}

/**
 * Return the current nano-TON balance of the cocoon node wallet (the SC that
 * receives the staked TON from the owner). Used by the wizard's resume gate
 * to detect "already funded but not yet started" so the user lands on Step 4
 * directly instead of being asked to re-fund a depleted owner wallet.
 *
 * Returns 0n if the cocoon_wallet contract has never received an incoming
 * message (its address is derived deterministically but the SC isn't
 * deployed until the first transfer).
 */
export async function getCocoonWalletBalance(bridge: TonBridgePort): Promise<bigint> {
  const data = await loadCocoonWallet()
  if (!data) throw new Error('Cocoon wallet not initialized')
  return BigInt(await bridge.getBalance(data.nodeAddress))
}

/**
 * Transfer TON from the owner (V4R2) wallet to the cocoon node wallet.
 *
 * @param bridge  Connected TON bridge port.
 * @param amount  Nano-TON amount to send, or 'max' to send everything minus
 *                the gas reserve (0.5 TON).
 *
 * @returns bocHash, seqno, and the actual sentAmount (as bigint).
 *
 * Throws if:
 *  - The Cocoon wallet has not been generated.
 *  - The owner balance is too low to fund (< OWNER_GAS_RESERVE).
 *  - An explicit amount exceeds the available balance minus the gas reserve.
 */
export async function fundCocoonFromOwner(
  bridge: TonBridgePort,
  amount: bigint | 'max'
): Promise<{ bocHash: string; seqno: number; sentAmount: bigint }> {
  const data = await loadCocoonWallet()
  if (!data) throw new Error('Cocoon wallet not initialized')

  const balance = BigInt(await bridge.getBalance(data.ownerAddress))
  let sendAmount: bigint

  if (amount === 'max') {
    if (balance <= OWNER_GAS_RESERVE) {
      throw new Error(`Owner balance ${balance} too low to fund cocoon (need > ${OWNER_GAS_RESERVE})`)
    }
    sendAmount = balance - OWNER_GAS_RESERVE
  } else {
    if (amount <= 0n) throw new Error('Amount must be positive')
    if (amount > balance - OWNER_GAS_RESERVE) {
      throw new Error(`Amount ${amount} exceeds balance minus gas reserve`)
    }
    sendAmount = amount
  }

  log.info(`Auto-funding cocoon wallet: ${sendAmount} nanoTON`)
  const result = await sendFromOwnerWallet(bridge, data.ownerMnemonic, Address.parse(data.nodeAddress), sendAmount)
  return { ...result, sentAmount: sendAmount }
}
