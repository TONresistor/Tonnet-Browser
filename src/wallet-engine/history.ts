/**
 * Wallet transaction history.
 * Stores and retrieves encrypted transaction records.
 */

import type { HistoryStore } from './ports'
import { WALLET_HISTORY_CACHE_LIMIT } from './constants'
import type { WalletTransaction } from './schemas'
import { createLogger, type WalletLogger } from './logger'
import { rawToFriendly } from './address-utils'
import { carryLocalMetadata, mergeHistory, sameHistory } from './history-merge'

function toFriendly(addr: string): string {
  return rawToFriendly(addr) ?? addr
}

export class WalletHistoryManager {
  private storage: HistoryStore
  private cache: WalletTransaction[] | null = null
  private readonly listeners = new Set<() => void>()
  private cacheEpoch = 0
  /** Serializes cache-mutating ops so concurrent add/updateStatus/reconcile
   *  (e.g. a fire-and-forget new-tx reconcile racing get-history) can't lose an
   *  update via read-modify-write interleaving. */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    storage: HistoryStore,
    private readonly log: WalletLogger = createLogger('wallet:history')
  ) {
    this.storage = storage
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn)
    this.tail = run.catch(() => {})
    return run
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): WalletTransaction[] {
    return structuredClone(this.cache ?? [])
  }

  private updateCache(value: WalletTransaction[]): void {
    this.cacheEpoch++
    this.cache = value
    for (const listener of this.listeners) listener()
  }

  /**
   * Add a transaction to the history (prepend, newest first).
   */
  async add(tx: WalletTransaction): Promise<void> {
    return this.serialize(async () => {
      const history = await this.loadCache(true)
      const previous = history.find(
        (item) => item.id === tx.id || Boolean(tx.operationId && item.operationId === tx.operationId)
      )
      const addition = { ...tx }
      if (previous) carryLocalMetadata(previous, addition)
      const next = [
        { ...previous, ...addition },
        ...history.filter((item) => item.id !== tx.id && !(tx.operationId && item.operationId === tx.operationId)),
      ]
      await this.storage.write(next)
      this.updateCache(next)
      this.log.event('debug', 'wallet.history.added', 'wallet history entry added', {
        type: tx.type,
        status: tx.status,
      })
    })
  }

  /**
   * Get all transactions.
   */
  async getAll(): Promise<WalletTransaction[]> {
    return this.loadCache(false)
  }

  private async loadCache(ownsWriteQueue: boolean): Promise<WalletTransaction[]> {
    if (this.cache !== null) return this.cache
    const epoch = this.cacheEpoch
    const data = await this.storage.read()
    if (epoch !== this.cacheEpoch) return this.snapshot()
    const txs = data ?? []
    // Migrate raw addresses (0:hex) to friendly format
    let migrated = false
    for (const tx of txs) {
      if (tx.address && tx.address.includes(':')) {
        tx.address = toFriendly(tx.address)
        migrated = true
      }
    }
    const commit = async (): Promise<WalletTransaction[]> => {
      if (epoch !== this.cacheEpoch) return this.snapshot()
      if (migrated) {
        await this.storage.write(txs)
        this.log.info('Migrated transaction addresses to friendly format')
      }
      if (epoch !== this.cacheEpoch) return this.snapshot()
      this.updateCache(txs)
      return txs
    }
    // Mutations already own the queue; public reads enqueue only migration writes.
    return migrated && !ownsWriteQueue ? this.serialize(commit) : commit()
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
      const history = await this.loadCache(true)
      const tx = history.find((t) => t.id === id)
      if (tx) {
        if (tx.operationState) return
        if (tx.status === status) return
        const next = history.map((entry) => (entry.id === id ? { ...entry, status } : entry))
        await this.storage.write(next)
        this.updateCache(next)
      }
    })
  }

  async reconcile(onChain: WalletTransaction[], isCurrent = () => true): Promise<WalletTransaction[]> {
    return this.serialize(async () => {
      if (!isCurrent()) return this.snapshot()
      const cached = await this.loadCache(true)
      if (!isCurrent()) return this.snapshot()
      const capped = mergeHistory(cached, onChain, WALLET_HISTORY_CACHE_LIMIT)
      if (sameHistory(cached, capped)) return cached
      await this.storage.write(capped)
      if (isCurrent()) this.updateCache(capped)
      return capped
    })
  }

  /**
   * Clear all transaction history.
   */
  async clear(): Promise<void> {
    await this.serialize(async () => {
      await this.storage.delete()
      this.updateCache([])
    })
    this.log.info('Transaction history cleared')
  }
}

// Singleton removed: use ServiceRegistry from services.ts
