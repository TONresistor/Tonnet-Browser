/**
 * Payment policy store.
 * Manages per-site payment modes, spending limits, and rate limiting.
 * Singleton, shared across all tabs/sessions (cross-tab global).
 * Spending data is persisted to disk via SafeStorageWrapper (debounced 5s).
 */

import { getSetting } from '../settings'
import {
  RATE_LIMIT_MAX_PER_SECOND,
  RATE_LIMIT_BURST_PER_10S,
  POLICY_CLEANUP_INTERVAL_MS,
  POLICY_SAVE_DEBOUNCE_MS,
  SPENDING_RETENTION_MS,
  ONE_DAY_MS,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_ONE_SECOND_MS,
} from './constants'
import type { PaymentMode, SitePolicy } from '../../shared/types'
import { createLogger } from '../../shared/logger'
import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
const log = createLogger('payment-policy')

interface SpendingRecord {
  amount: string
  timestamp: number
}

interface RateLimitEntry {
  timestamps: number[]
}

/**
 * Normalize a hostname to its second-level domain.
 * Ensures subdomains share the same spending bucket as their parent.
 * e.g. sub.boards.ton -> boards.ton, api.evil.com -> evil.com, localhost -> localhost
 * IP addresses are returned as-is to avoid collisions (127.0.0.1 must not become 0.1).
 */
export function normalizeToSecondLevel(hostname: string): string {
  const host = hostname.replace(/^https?:\/\//, '').split('/')[0]
  // IP addresses: return as-is (IPv4 dotted quad or IPv6 bracket notation)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
    return host
  }
  const parts = host.split('.')
  if (parts.length >= 2) {
    return parts.slice(-2).join('.')
  }
  return host
}

export class PaymentPolicyStore {
  private siteModes: Map<string, PaymentMode> = new Map()
  private spending: Map<string, SpendingRecord[]> = new Map()
  private rateLimits: Map<string, RateLimitEntry> = new Map()
  private reservations: Map<string, { domain: string; record: SpendingRecord }> = new Map()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private storage = new SafeStorageWrapper('payment-spending')
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // FIX 7: Periodic cleanup of stale entries
    this.cleanupTimer = setInterval(() => this.cleanup(), POLICY_CLEANUP_INTERVAL_MS)
  }

  async init(): Promise<void> {
    try {
      const saved = await this.storage.read<Record<string, SpendingRecord[]>>()
      if (saved) {
        for (const [domain, records] of Object.entries(saved)) {
          this.spending.set(domain, records)
        }
      }
    } catch (err) {
      log.error('Failed to load spending records:', err)
    }
  }

  /** Serialize the in-memory spending map and persist it to disk. */
  private async persistSpending(): Promise<void> {
    const data: Record<string, SpendingRecord[]> = {}
    for (const [domain, records] of this.spending) {
      data[domain] = records
    }
    await this.storage.write(data)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null
      try {
        await this.persistSpending()
      } catch (err) {
        log.error('Failed to save spending records:', err)
      }
    }, POLICY_SAVE_DEBOUNCE_MS)
  }

  /**
   * Remove spending records older than 30 days and empty rate limit entries.
   */
  cleanup(): void {
    const now = Date.now()
    const thirtyDaysMs = SPENDING_RETENTION_MS
    let removed = 0

    for (const [domain, records] of this.spending) {
      const filtered = records.filter((r) => now - r.timestamp < thirtyDaysMs)
      removed += records.length - filtered.length
      if (filtered.length === 0) {
        this.spending.delete(domain)
      } else {
        this.spending.set(domain, filtered)
      }
    }

    for (const [domain, entry] of this.rateLimits) {
      if (entry.timestamps.length === 0) {
        this.rateLimits.delete(domain)
        removed++
      }
    }

    if (removed > 0) {
      log.info(`Cleaned up ${removed} stale payment policy entries`)
    }
  }

  async destroy(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    // Final flush: persist any in-flight spending records before shutdown
    try {
      await this.persistSpending()
    } catch (err) {
      log.error('Failed to flush spending records on shutdown:', err)
    }
  }

  getSiteMode(domain: string): PaymentMode {
    const normalized = normalizeToSecondLevel(domain)

    // Check site-specific policy from settings
    const walletSettings = getSetting('wallet')
    const sitePolicy = walletSettings.sitePolicies.find((p: SitePolicy) => p.domain === normalized)
    if (sitePolicy) return sitePolicy.mode

    // Check in-memory override
    const override = this.siteModes.get(normalized)
    if (override) return override

    // Fall back to global default
    return walletSettings.paymentMode
  }

  setSiteMode(domain: string, mode: PaymentMode): void {
    const normalized = normalizeToSecondLevel(domain)
    this.siteModes.set(normalized, mode)
    log.info(`Site mode set: ${normalized} -> ${mode}`)
  }

  canPay(domain: string, amount: string): boolean {
    const normalized = normalizeToSecondLevel(domain)
    const walletSettings = getSetting('wallet')
    const limits = walletSettings.limits

    // Rate limit check
    if (!this.checkRateLimit(normalized)) {
      log.warn(`Rate limit exceeded for ${normalized}`)
      return false
    }

    // Per-request limit (0 = unlimited)
    if (limits.perRequest !== '0' && BigInt(amount) > BigInt(limits.perRequest)) {
      log.warn(`Per-request limit exceeded for ${normalized}: ${amount} > ${limits.perRequest}`)
      return false
    }

    const records = this.spending.get(normalized) || []
    const now = Date.now()

    // Per-day limit: rolling 24h
    if (limits.perDay !== '0') {
      const dayAgo = now - ONE_DAY_MS
      const dayTotal = records.filter((r) => r.timestamp >= dayAgo).reduce((sum, r) => sum + BigInt(r.amount), 0n)
      if (dayTotal + BigInt(amount) > BigInt(limits.perDay)) {
        log.warn(`Per-day limit exceeded for ${normalized}`)
        return false
      }
    }

    // Per-site-per-month limit: rolling 30d
    if (limits.perSitePerMonth !== '0') {
      const monthAgo = now - SPENDING_RETENTION_MS
      const monthTotal = records.filter((r) => r.timestamp >= monthAgo).reduce((sum, r) => sum + BigInt(r.amount), 0n)
      if (monthTotal + BigInt(amount) > BigInt(limits.perSitePerMonth)) {
        log.warn(`Per-site-per-month limit exceeded for ${normalized}`)
        return false
      }
    }

    return true
  }

  /**
   * Atomically check limits and reserve the payment amount.
   * Returns a reservationId if successful, or null if limits exceeded.
   * Use rollbackPayment() to undo if the payment fails.
   */
  reservePayment(domain: string, amount: string): string | null {
    if (!this.canPay(domain, amount)) return null

    const normalized = normalizeToSecondLevel(domain)
    const now = Date.now()
    const reservationId = `${normalized}:${now}:${crypto.randomUUID()}`
    const record: SpendingRecord = { amount, timestamp: now }

    const records = this.spending.get(normalized) || []
    records.push(record)
    this.spending.set(normalized, records)

    // Update rate limit timestamps (same timestamp as record for rollback correlation)
    const entry = this.rateLimits.get(normalized) || { timestamps: [] }
    entry.timestamps.push(now)
    this.rateLimits.set(normalized, entry)

    this.reservations.set(reservationId, { domain: normalized, record })
    log.info(`Payment reserved: ${normalized}, ${amount} nanoTON (${reservationId})`)
    this.scheduleSave()
    return reservationId
  }

  /**
   * Confirm a reservation (payment succeeded). Clears the reservation tracking.
   */
  confirmPayment(reservationId: string): void {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return
    this.reservations.delete(reservationId)
    log.info(`Payment confirmed: ${reservation.domain}, ${reservation.record.amount} nanoTON`)
  }

  /**
   * Roll back a reservation (payment failed). Removes the spending record.
   */
  rollbackPayment(reservationId: string): void {
    const reservation = this.reservations.get(reservationId)
    if (!reservation) return
    this.reservations.delete(reservationId)

    const records = this.spending.get(reservation.domain)
    if (records) {
      const idx = records.indexOf(reservation.record)
      if (idx !== -1) records.splice(idx, 1)
      if (records.length === 0) this.spending.delete(reservation.domain)
    }

    // Roll back the rate-limit timestamp added during reservation
    const entry = this.rateLimits.get(reservation.domain)
    if (entry) {
      const tsIdx = entry.timestamps.lastIndexOf(reservation.record.timestamp)
      if (tsIdx !== -1) entry.timestamps.splice(tsIdx, 1)
    }

    log.info(`Payment rolled back: ${reservation.domain}, ${reservation.record.amount} nanoTON`)
    this.scheduleSave()
  }

  getSpending(domain: string): { day: string; month: string } {
    const normalized = normalizeToSecondLevel(domain)
    const records = this.spending.get(normalized) || []
    const now = Date.now()

    const dayAgo = now - ONE_DAY_MS
    const monthAgo = now - SPENDING_RETENTION_MS

    const day = records
      .filter((r) => r.timestamp >= dayAgo)
      .reduce((sum, r) => sum + BigInt(r.amount), 0n)
      .toString()

    const month = records
      .filter((r) => r.timestamp >= monthAgo)
      .reduce((sum, r) => sum + BigInt(r.amount), 0n)
      .toString()

    return { day, month }
  }

  private checkRateLimit(domain: string): boolean {
    const entry = this.rateLimits.get(domain)
    if (!entry) return true

    const now = Date.now()

    // Clean old timestamps (older than rate limit window)
    entry.timestamps = entry.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

    // Max 1 per second
    const oneSecAgo = now - RATE_LIMIT_ONE_SECOND_MS
    const recentCount = entry.timestamps.filter((t) => t >= oneSecAgo).length
    if (recentCount >= RATE_LIMIT_MAX_PER_SECOND) return false

    // Burst: max 3 per 10 seconds
    if (entry.timestamps.length >= RATE_LIMIT_BURST_PER_10S) return false

    return true
  }
}

// Singleton removed: use ServiceRegistry from services.ts
