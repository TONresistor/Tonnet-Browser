/**
 * History Manager with 2 privacy modes:
 * - MEMORY: RAM only, cleared on exit (private/live mode)
 * - PERSISTENT: Automatically encrypted disk storage via OS keychain
 */

import { EventEmitter } from 'events'
import { getSetting, setSetting } from '../settings'
import { SafeStorageWrapper } from './safe-storage-wrapper'
import { createLogger } from '../../shared/logger'
import { HistoryEntry, HistoryStats } from '../../shared/types'
const log = createLogger('history')

export enum HistoryMode {
  MEMORY = 'memory',
  PERSISTENT = 'persistent',
}

export type { HistoryEntry, HistoryStats }

export class HistoryManager extends EventEmitter {
  private entries: Map<string, HistoryEntry> = new Map()
  private maxEntries: number = 1000
  private mode: HistoryMode = HistoryMode.MEMORY
  private storage: SafeStorageWrapper | null = null
  private readyPromise: Promise<void>
  private isReady: boolean = false
  private pendingEntries: Array<{ url: string; title: string; favicon?: string }> = []

  constructor() {
    super()
    this.readyPromise = this.loadSettings().then(() => {
      this.isReady = true
      // Flush buffered entries that arrived before initialization completed
      if (this.pendingEntries.length > 0) {
        log.debug(`Flushing ${this.pendingEntries.length} buffered history entries`)
        for (const entry of this.pendingEntries) {
          this.addEntry(entry.url, entry.title, entry.favicon)
        }
        this.pendingEntries = []
      }
    })
  }

  async ready(): Promise<void> {
    return this.readyPromise
  }

  private async loadSettings(): Promise<void> {
    const settings = getSetting('privacy')
    this.mode = (settings.historyMode as HistoryMode) || HistoryMode.MEMORY
    this.maxEntries = settings.historyMaxEntries || 1000

    log.info(`Mode: ${this.mode}, Max entries: ${this.maxEntries}`)

    // Initialize persistent storage if needed
    if (this.mode === HistoryMode.PERSISTENT) {
      this.storage = new SafeStorageWrapper('history')

      // Auto-load existing history
      try {
        const data = await this.storage.read<HistoryEntry[]>()
        if (data && Array.isArray(data)) {
          this.entries.clear()
          data.forEach((entry) => {
            this.entries.set(entry.id, entry)
          })
          log.info(`Loaded ${data.length} entries from persistent storage`)
        }
      } catch (error) {
        log.error('Failed to load persistent history:', error)
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
        log.info('Migrating from persistent to memory')
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
          data.forEach((entry) => {
            this.entries.set(entry.id, entry)
          })
          log.info(`Loaded ${data.length} entries from persistent storage`)
        }
      } else {
        // MEMORY mode - keep current in-memory entries
        this.storage = null
      }

      this.emit('mode-changed', newMode)
      log.info(`Mode changed: ${oldMode} → ${newMode}`)
      return { success: true }
    } catch (error) {
      log.error('Failed to change mode:', error)
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
    // Buffer entry if manager not yet ready (readyPromise not resolved)
    if (!this.isReady) {
      log.debug(`HistoryManager not ready, buffering entry: ${url}`)
      this.pendingEntries.push({ url, title, favicon })
      return
    }

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

      log.debug(`Updated: ${url} (visits: ${existing.visitCount})`)
    } else {
      // Create new entry
      const entry: HistoryEntry = {
        id,
        url,
        title: title || url,
        visitedAt: Date.now(),
        visitCount: 1,
        favicon,
      }

      this.entries.set(id, entry)
      log.debug(`Added: ${url}`)

      // Enforce limit
      this.enforceLimit()
    }

    this.emit('entry-added', url)

    // Auto-save if persistent mode
    if (this.mode === HistoryMode.PERSISTENT) {
      this.savePersistent().catch((err) => {
        log.error('Auto-save failed:', err)
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
    const sorted = Array.from(this.entries.values()).sort((a, b) => a.visitedAt - b.visitedAt)

    const toRemove = sorted.slice(0, sorted.length - this.maxEntries)
    toRemove.forEach((entry) => {
      this.entries.delete(entry.id)
    })

    log.info(`Enforced limit: removed ${toRemove.length} old entries`)
  }

  /**
   * Search history
   */
  async search(query: string, limit: number = 50): Promise<HistoryEntry[]> {
    await this.readyPromise
    const lowerQuery = query.toLowerCase()
    return Array.from(this.entries.values())
      .filter((entry) => entry.url.toLowerCase().includes(lowerQuery) || entry.title.toLowerCase().includes(lowerQuery))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
  }

  /**
   * Get recent entries
   */
  async getRecent(limit: number = 100): Promise<HistoryEntry[]> {
    await this.readyPromise
    return Array.from(this.entries.values())
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit)
  }

  /**
   * Get top visited sites
   */
  getTopVisited(limit: number = 20): HistoryEntry[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.visitCount > 1)
      .sort((a, b) => b.visitCount - a.visitCount)
      .slice(0, limit)
  }

  /**
   * Get entries by date range
   */
  getByDateRange(startDate: number, endDate: number): HistoryEntry[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.visitedAt >= startDate && entry.visitedAt <= endDate)
      .sort((a, b) => b.visitedAt - a.visitedAt)
  }

  /**
   * Delete single entry
   */
  deleteEntry(id: string): boolean {
    const deleted = this.entries.delete(id)

    if (deleted) {
      this.emit('entry-deleted', id)
      log.debug(`Deleted entry: ${id}`)

      // Auto-save if persistent
      if (this.mode === HistoryMode.PERSISTENT) {
        this.savePersistent().catch((err) => {
          log.error('Auto-save after delete failed:', err)
        })
      }
    }

    return deleted
  }

  /**
   * Delete entries by URL pattern
   */
  deleteByPattern(pattern: string): number {
    // Anti-ReDoS protection: validate pattern complexity
    if (!pattern || pattern.length > 500) {
      return 0
    }

    // Detect potentially dangerous patterns (catastrophic backtracking)
    const dangerousPatterns = [
      /(\*|\+|\{[0-9,]+\}){3,}/, // Multiple quantifiers in a row
      /(\(.*\+.*\))\1/, // Nested repeating groups
      /(.+\*){2,}/, // Multiple greedy quantifiers
    ]

    for (const dangerous of dangerousPatterns) {
      if (dangerous.test(pattern)) {
        throw new Error('Pattern contains potentially dangerous constructs')
      }
    }

    let regex: RegExp
    try {
      regex = new RegExp(pattern, 'i')
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`)
    }

    const toDelete: string[] = []

    for (const [id, entry] of this.entries) {
      try {
        if (regex.test(entry.url) || regex.test(entry.title)) {
          toDelete.push(id)
        }
      } catch (err) {
        // Skip entry if regex test fails (protection against edge cases)
        log.error(`Regex test failed for entry ${id}:`, err)
      }
    }

    toDelete.forEach((id) => this.entries.delete(id))

    if (toDelete.length > 0) {
      this.emit('entries-deleted', toDelete.length)
      log.info(`Deleted ${toDelete.length} entries matching pattern: ${pattern}`)

      // Auto-save if persistent
      if (this.mode === HistoryMode.PERSISTENT) {
        this.savePersistent().catch((err) => {
          log.error('Auto-save after batch delete failed:', err)
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
    log.info(`Cleared ${count} entries`)

    // Delete persistent file if exists
    if (this.mode === HistoryMode.PERSISTENT && this.storage) {
      this.storage.delete().catch((err) => {
        log.error('Failed to delete persistent history:', err)
      })
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<HistoryStats> {
    await this.readyPromise
    const entries = Array.from(this.entries.values())

    return {
      total: entries.length,
      mode: this.mode,
      oldestEntry: entries.length > 0 ? Math.min(...entries.map((e) => e.visitedAt)) : undefined,
      newestEntry: entries.length > 0 ? Math.max(...entries.map((e) => e.visitedAt)) : undefined,
      isLocked: false,
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
    log.debug(`Saved ${entries.length} entries to persistent storage`)
  }

  /**
   * Called on app exit
   */
  async onAppExit(): Promise<void> {
    if (this.mode === HistoryMode.MEMORY) {
      // Clear everything
      this.clear()
      log.info('Memory cleared on exit')
    } else if (this.mode === HistoryMode.PERSISTENT) {
      // Final save
      await this.savePersistent()
      log.info('Persistent history saved on exit')
    }
  }
}

// Singleton
export const historyManager = new HistoryManager()
