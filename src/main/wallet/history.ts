/**
 * Wallet transaction history.
 * Stores and retrieves encrypted transaction records.
 */

import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
import { WALLET_HISTORY_FILE_NAME, WALLET_HISTORY_CACHE_LIMIT } from './constants'
import type { WalletTransaction } from '../../shared/types'
import { createLogger } from '../../shared/logger'
import { rawToFriendly } from './address-utils'
import { mergeHistory, sameHistory } from './history-merge'
const log = createLogger('wallet:history')

function toFriendly(addr: string): string {
  return rawToFriendly(addr) ?? addr
}

export class WalletHistoryManager {
  private storage: SafeStorageWrapper
  private cache: WalletTransaction[] | null = null
  /** Serializes cache-mutating ops so concurrent add/updateStatus/reconcile
   *  (e.g. a fire-and-forget new-tx reconcile racing get-history) can't lose an
   *  update via read-modify-write interleaving. */
  private tail: Promise<unknown> = Promise.resolve()

  constructor() {
    this.storage = new SafeStorageWrapper(WALLET_HISTORY_FILE_NAME)
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => {})
    return run
  }

  /**
   * Add a transaction to the history (prepend, newest first).
   */
  async add(tx: WalletTransaction): Promise<void> {
    return this.serialize(async () => {
      const history = await this.getAll()
      history.unshift(tx)
      await this.storage.write(history)
      this.cache = history
      log.info(`Transaction added: ${tx.type} ${tx.amount} nanoTON`)
    })
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
    return this.serialize(async () => {
      const history = await this.getAll()
      const tx = history.find((t) => t.id === id)
      if (tx) {
        if (tx.status === status) return
        tx.status = status
        await this.storage.write(history)
        this.cache = history
      }
    })
  }

  async reconcile(onChain: WalletTransaction[]): Promise<WalletTransaction[]> {
    return this.serialize(async () => {
      const cached = await this.getAll()
      const capped = mergeHistory(cached, onChain, WALLET_HISTORY_CACHE_LIMIT)
      if (sameHistory(cached, capped)) return cached
      await this.storage.write(capped)
      this.cache = capped
      return capped
    })
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
