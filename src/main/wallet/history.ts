/**
 * Wallet transaction history.
 * Stores and retrieves encrypted transaction records.
 */

import { Address } from '@ton/core'
import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
import { WALLET_HISTORY_FILE_NAME } from '../../shared/constants'
import type { WalletTransaction } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('wallet:history')

/** Convert raw TON address (0:hex) to friendly non-bounceable format. */
function toFriendly(addr: string): string {
  if (!addr || !addr.includes(':')) return addr
  try {
    return Address.parseRaw(addr).toString({ bounceable: false })
  } catch {
    return addr
  }
}

export class WalletHistoryManager {
  private storage: SafeStorageWrapper
  private cache: WalletTransaction[] | null = null

  constructor() {
    this.storage = new SafeStorageWrapper(WALLET_HISTORY_FILE_NAME)
  }

  /**
   * Add a transaction to the history (prepend, newest first).
   */
  async add(tx: WalletTransaction): Promise<void> {
    const history = await this.getAll()
    history.unshift(tx)
    await this.storage.write(history)
    this.cache = history
    log.info(`Transaction added: ${tx.type} ${tx.amount} nanoTON`)
  }

  /**
   * Get all transactions.
   */
  async getAll(): Promise<WalletTransaction[]> {
    if (this.cache !== null) return this.cache
    const data = await this.storage.read<WalletTransaction[]>()
    const txs = data ?? []
    // Migrate raw addresses (0:hex) to friendly format
    let migrated = false
    for (const tx of txs) {
      if (tx.address && tx.address.includes(':')) {
        tx.address = toFriendly(tx.address)
        migrated = true
      }
    }
    if (migrated) {
      await this.storage.write(txs)
      log.info('Migrated transaction addresses to friendly format')
    }
    this.cache = txs
    return this.cache
  }

  /**
   * Get the most recent N transactions.
   */
  async getRecent(limit: number = 50): Promise<WalletTransaction[]> {
    const all = await this.getAll()
    return all.slice(0, limit)
  }

  /**
   * Update the status of a transaction by ID.
   */
  async updateStatus(id: string, status: WalletTransaction['status']): Promise<void> {
    const history = await this.getAll()
    const tx = history.find((t) => t.id === id)
    if (tx) {
      tx.status = status
      await this.storage.write(history)
      this.cache = history
    }
  }

  /**
   * Merge on-chain transactions with local ones.
   * On-chain is source of truth. Local pending txs are kept until confirmed on-chain.
   * x402 metadata from local records is transferred to matching on-chain records.
   */
  merge(onChain: WalletTransaction[], local: WalletTransaction[]): WalletTransaction[] {
    const merged = [...onChain]

    for (const localTx of local) {
      if (localTx.status === 'pending') {
        const confirmedOnChain = onChain.some(
          (onTx) =>
            onTx.hash === localTx.hash ||
            (onTx.address === localTx.address &&
              onTx.amount === localTx.amount &&
              Math.abs(onTx.timestamp - localTx.timestamp) < 120000)
        )
        if (!confirmedOnChain) {
          merged.unshift(localTx)
        }
      }

      if (localTx.type === 'x402' && localTx.x402Domain) {
        const match = merged.find(
          (m) =>
            m.address === localTx.address &&
            m.amount === localTx.amount &&
            Math.abs(m.timestamp - localTx.timestamp) < 120000
        )
        if (match) {
          match.type = 'x402'
          match.x402Domain = localTx.x402Domain
          match.x402Url = localTx.x402Url
        }
      }
    }

    return merged.sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Clear all transaction history.
   */
  async clear(): Promise<void> {
    this.cache = []
    await this.storage.delete()
    log.info('Transaction history cleared')
  }
}

export const walletHistoryManager = new WalletHistoryManager()
