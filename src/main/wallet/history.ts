/**
 * Wallet transaction history.
 * Stores and retrieves encrypted transaction records.
 */

import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
import { WALLET_HISTORY_FILE_NAME, WALLET_HISTORY_CACHE_LIMIT } from './constants'
import type { WalletTransaction } from '../../shared/types'
import { createLogger } from '../../shared/logger'
import { rawToFriendly } from './address-utils'
const log = createLogger('wallet:history')

function toFriendly(addr: string): string {
  return rawToFriendly(addr) ?? addr
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

  async reconcile(onChain: WalletTransaction[]): Promise<WalletTransaction[]> {
    const cached = await this.getAll()
    const keyOf = (tx: WalletTransaction): string => (tx.hash ? `h:${tx.hash}` : `i:${tx.id}`)
    const byKey = new Map<string, WalletTransaction>()

    for (const tx of cached) byKey.set(keyOf(tx), tx)

    for (const tx of onChain) {
      const key = keyOf(tx)
      const prev = byKey.get(key)
      if (prev?.type === 'x402') {
        tx.type = 'x402'
        tx.x402Domain = prev.x402Domain
        tx.x402Url = prev.x402Url
      }
      byKey.set(key, tx)
    }

    const result = [...byKey.values()].filter((tx) => {
      if (tx.status !== 'pending') return true
      return !onChain.some(
        (on) =>
          keyOf(on) !== keyOf(tx) &&
          on.address === tx.address &&
          on.amount === tx.amount &&
          Math.abs(on.timestamp - tx.timestamp) < 120000
      )
    })

    result.sort((a, b) => b.timestamp - a.timestamp)
    const capped = result.slice(0, WALLET_HISTORY_CACHE_LIMIT)
    await this.storage.write(capped)
    this.cache = capped
    return capped
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

// Singleton removed: use ServiceRegistry from services.ts
