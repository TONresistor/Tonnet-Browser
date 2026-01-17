/**
 * History Manager with 2 privacy modes:
 * - MEMORY: RAM only, cleared on exit (private/live mode)
 * - PERSISTENT: Automatically encrypted disk storage via OS keychain
 */

import { EventEmitter } from 'events'
import { getSetting, setSetting } from '../settings'
import { SafeStorageWrapper } from './safe-storage-wrapper'
import { logger } from '../../shared/logger'

export enum HistoryMode {
  MEMORY = 'memory',
  PERSISTENT = 'persistent'
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
  visitCount: number
  favicon?: string
}

export interface HistoryStats {
  total: number
  mode: HistoryMode
  oldestEntry?: number
  newestEntry?: number
  isLocked: boolean
}

export class HistoryManager extends EventEmitter {
  private entries: Map<string, HistoryEntry> = new Map()
  private maxEntries: number = 1000
  private mode: HistoryMode = HistoryMode.MEMORY
  private storage: SafeStorageWrapper | null = null

  constructor() {
    super()
    this.loadSettings()
  }

  private async loadSettings(): Promise<void> {
    const settings = getSetting('privacy')
    this.mode = (settings.historyMode as HistoryMode) || HistoryMode.MEMORY
    this.maxEntries = settings.historyMaxEntries || 1000

    logger.info('HistoryManager', `Mode: ${this.mode}, Max entries: ${this.maxEntries}`)

    // Initialize persistent storage if needed
    if (this.mode === HistoryMode.PERSISTENT) {
      this.storage = new SafeStorageWrapper('history')

      // Auto-load existing history
      try {
        const data = await this.storage.read<HistoryEntry[]>()
        if (data && Array.isArray(data)) {
          this.entries.clear()
          data.forEach(entry => {
            this.entries.set(entry.id, entry)
          })
          logger.info('HistoryManager', `Loaded ${data.length} entries from persistent storage`)
        }
      } catch (error) {
        logger.error('HistoryManager', 'Failed to load persistent history:', error)
      }
    }
  }

  /**
   * Change history mode (no password needed)
   */
  async changeMode(newMode: HistoryMode): Promise<{ success: boolean; error?: string }> {
    const oldMode = this.mode

    try {
      // Save current entries before switching
      if (oldMode === HistoryMode.PERSISTENT) {
        logger.info('HistoryManager', 'Migrating from persistent to memory')
      }

      // Update mode
      this.mode = newMode
      setSetting('privacy', { historyMode: newMode })

      // Reinitialize storage
      if (newMode === HistoryMode.PERSISTENT) {
        this.storage = new SafeStorageWrapper('history')
        // Auto-load existing history
        const data = await this.storage.read<HistoryEntry[]>()
        if (data && Array.isArray(data)) {
          this.entries.clear()
          data.forEach(entry => {
            this.entries.set(entry.id, entry)
          })
          logger.info('HistoryManager', `Loaded ${data.length} entries from persistent storage`)
        }
      } else {
        // MEMORY mode - keep current in-memory entries
        this.storage = null
      }

      this.emit('mode-changed', newMode)
      logger.info('HistoryManager', `Mode changed: ${oldMode} → ${newMode}`)
      return { success: true }
    } catch (error) {
      logger.error('HistoryManager', 'Failed to change mode:', error)
      // Rollback
      this.mode = oldMode
      setSetting('privacy', { historyMode: oldMode })
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Add entry to history
   */
  addEntry(url: string, title: string, favicon?: string): void {
    // Don't record internal pages
    if (url.startsWith('ton://') || url.startsWith('about:') || url.startsWith('data:')) {
      return
    }

    // Don't record empty/invalid URLs
    if (!url || url.length < 5) {
      return
    }

    const id = this.generateId(url)
    const existing = this.entries.get(id)

    if (existing) {
      // Update existing entry
      existing.title = title || existing.title
      existing.visitedAt = Date.now()
      existing.visitCount++
      if (favicon) {
        existing.favicon = favicon
      }

      logger.debug('HistoryManager', `Updated: ${url} (visits: ${existing.visitCount})`)
    } else {
      // Create new entry
      const entry: HistoryEntry = {
        id,
        url,
        title: title || url,
        visitedAt: Date.now(),
        visitCount: 1,
        favicon
      }

      this.entries.set(id, entry)
      logger.debug('HistoryManager', `Added: ${url}`)

      // Enforce limit
      this.enforceLimit()
    }

    this.emit('entry-added', url)

    // Auto-save if persistent mode
    if (this.mode === HistoryMode.PERSISTENT) {
      this.savePersistent().catch(err => {
        logger.error('HistoryManager', 'Auto-save failed:', err)
      })
    }
  }

  private generateId(url: string): string {
    // Use URL as ID (remove fragments and query for deduplication)
    try {
      const parsed = new URL(url)
      const cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`
      return Buffer.from(cleanUrl).toString('base64url')
    } catch {
      return Buffer.from(url).toString('base64url')
    }
  }

  private enforceLimit(): void {
    if (this.entries.size <= this.maxEntries) {
      return
    }

    // Remove oldest entries
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => a.visitedAt - b.visitedAt)

    const toRemove = sorted.slice(0, sorted.length - this.maxEntries)
    toRemove.forEach(entry => {
      this.entries.delete(entry.id)
    })

    logger.info('HistoryManager', `Enforced limit: removed ${toRemove.length} old entries`)
  }

  /**
   * Search history
   */
  search(query: string, limit: number = 50): HistoryEntry[] {
    const lowerQuery = query.toLowerCase()
    return Array.from(this.entries.values())
      .filter(entry =>
        entry.url.toLowerCase().includes(lowerQuery) ||
        entry.title.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
  }

  /**
   * Get recent entries
   */
  getRecent(limit: number = 100): HistoryEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
  }

  /**
   * Get top visited sites
   */
  getTopVisited(limit: number = 20): HistoryEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.visitCount > 1)
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, limit)
  }

  /**
   * Get entries by date range
   */
  getByDateRange(startDate: number, endDate: number): HistoryEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.visitedAt >= startDate && entry.visitedAt <= endDate)
      .sort((a, b) => b.visitedAt - a.visitedAt)
  }

  /**
   * Delete single entry
   */
  deleteEntry(id: string): boolean {
    const deleted = this.entries.delete(id)

    if (deleted) {
      this.emit('entry-deleted', id)
      logger.debug('HistoryManager', `Deleted entry: ${id}`)

      // Auto-save if persistent
      if (this.mode === HistoryMode.PERSISTENT) {
        this.savePersistent().catch(err => {
          logger.error('HistoryManager', 'Auto-save after delete failed:', err)
        })
      }
    }

    return deleted
  }

  /**
   * Delete entries by URL pattern
   */
  deleteByPattern(pattern: string): number {
    const regex = new RegExp(pattern, 'i')
    const toDelete: string[] = []

    for (const [id, entry] of this.entries) {
      if (regex.test(entry.url) || regex.test(entry.title)) {
        toDelete.push(id)
      }
    }

    toDelete.forEach(id => this.entries.delete(id))

    if (toDelete.length > 0) {
      this.emit('entries-deleted', toDelete.length)
      logger.info('HistoryManager', `Deleted ${toDelete.length} entries matching pattern: ${pattern}`)

      // Auto-save if persistent
      if (this.mode === HistoryMode.PERSISTENT) {
        this.savePersistent().catch(err => {
          logger.error('HistoryManager', 'Auto-save after batch delete failed:', err)
        })
      }
    }

    return toDelete.length
  }

  /**
   * Clear all history
   */
  clear(): void {
    const count = this.entries.size
    this.entries.clear()

    this.emit('cleared')
    logger.info('HistoryManager', `Cleared ${count} entries`)

    // Delete persistent file if exists
    if (this.mode === HistoryMode.PERSISTENT && this.storage) {
      this.storage.delete().catch(err => {
        logger.error('HistoryManager', 'Failed to delete persistent history:', err)
      })
    }
  }

  /**
   * Get statistics
   */
  getStats(): HistoryStats {
    const entries = Array.from(this.entries.values())

    return {
      total: entries.length,
      mode: this.mode,
      oldestEntry: entries.length > 0
        ? Math.min(...entries.map(e => e.visitedAt))
        : undefined,
      newestEntry: entries.length > 0
        ? Math.max(...entries.map(e => e.visitedAt))
        : undefined,
      isLocked: false
    }
  }

  /**
   * Check if persistent file exists
   */
  hasPersistentFile(): boolean {
    if (!this.storage) {
      const tempStorage = new SafeStorageWrapper('history')
      return tempStorage.existsSync()
    }
    return this.storage.existsSync()
  }

  /**
   * Save to persistent storage (automatic encryption)
   */
  private async savePersistent(): Promise<void> {
    if (!this.storage) {
      return
    }

    const entries = Array.from(this.entries.values())
    await this.storage.write(entries)
    logger.debug('HistoryManager', `Saved ${entries.length} entries to persistent storage`)
  }

  /**
   * Called on app exit
   */
  async onAppExit(): Promise<void> {
    if (this.mode === HistoryMode.MEMORY) {
      // Clear everything
      this.clear()
      logger.info('HistoryManager', 'Memory cleared on exit')
    } else if (this.mode === HistoryMode.PERSISTENT) {
      // Final save
      await this.savePersistent()
      logger.info('HistoryManager', 'Persistent history saved on exit')
    }
  }
}

// Singleton
export const historyManager = new HistoryManager()
