/**
 * Payment policy store.
 * Manages per-site payment modes, spending limits, and rate limiting.
 * Singleton, shared across all tabs/sessions (cross-tab global).
 * Spending data is persisted to disk via SafeStorageWrapper (debounced 5s).
 */

import { getSetting } from '../settings'
import { RATE_LIMIT_MAX_PER_SECOND, RATE_LIMIT_BURST_PER_10S } from '../../shared/constants'
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
 * Normalize a hostname to its second-level .ton domain.
 * e.g. sub.boards.ton -> boards.ton, mysite.ton -> mysite.ton
 */
export function normalizeToSecondLevel(hostname: string): string {
  const host = hostname.replace(/^https?:\/\//, '').split('/')[0]
  const parts = host.split('.')
  if (parts.length >= 2 && parts[parts.length - 1] === 'ton') {
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
    // FIX 7: Periodic cleanup of stale entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000)
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

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null
      try {
        const data: Record<string, SpendingRecord[]> = {}
        for (const [domain, records] of this.spending) {
          data[domain] = records
        }
        await this.storage.write(data)
      } catch (err) {
        log.error('Failed to save spending records:', err)
      }
    }, 5000)
  }

  /**
   * Remove spending records older than 30 days and empty rate limit entries.
   */
  cleanup(): void {
    const now = Date.now()
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

    for (const [domain, records] of this.spending) {
      const filtered = records.filter((r) => now - r.timestamp < thirtyDaysMs)
      if (filtered.length === 0) {
        this.spending.delete(domain)
      } else {
        this.spending.set(domain, filtered)
      }
    }

    for (const [domain, entry] of this.rateLimits) {
      if (entry.timestamps.length === 0) {
        this.rateLimits.delete(domain)
      }
    }

    log.info('Stale payment policy entries cleaned up')
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
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
      const dayAgo = now - 24 * 60 * 60 * 1000
      const dayTotal = records.filter((r) => r.timestamp >= dayAgo).reduce((sum, r) => sum + BigInt(r.amount), 0n)
      if (dayTotal + BigInt(amount) > BigInt(limits.perDay)) {
        log.warn(`Per-day limit exceeded for ${normalized}`)
        return false
      }
    }

    // Per-site-per-month limit: rolling 30d
    if (limits.perSitePerMonth !== '0') {
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000
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
    const reservationId = `${normalized}:${now}:${Math.random().toString(36).slice(2, 8)}`
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

    const dayAgo = now - 24 * 60 * 60 * 1000
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000

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

    // Clean old timestamps (older than 10s)
    entry.timestamps = entry.timestamps.filter((t) => now - t < 10000)

    // Max 1 per second
    const oneSecAgo = now - 1000
    const recentCount = entry.timestamps.filter((t) => t >= oneSecAgo).length
    if (recentCount >= RATE_LIMIT_MAX_PER_SECOND) return false

    // Burst: max 3 per 10 seconds
    if (entry.timestamps.length >= RATE_LIMIT_BURST_PER_10S) return false

    return true
  }
}

export const paymentPolicyStore = new PaymentPolicyStore()
