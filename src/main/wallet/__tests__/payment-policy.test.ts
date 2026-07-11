/**
 * Tests for PaymentPolicyStore — the spending-limit and rate-limit engine
 * behind the x402 auto-payment flow.
 *
 * This is the only guard between a malicious 402 server and the wallet
 * balance (see FINDING.md F-01). It was previously exercised only through a
 * mocked policyStore in payment-interceptor.test.ts, so the real canPay /
 * rate-limit / reserve-rollback logic had no coverage. These tests run that
 * real logic; only the disk (SafeStorageWrapper) and settings are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// In-memory stand-in for the encrypted spending file, so persistence can be
// round-tripped without touching disk or Electron safeStorage.
const { storageBackend } = vi.hoisted(() => ({ storageBackend: { data: null as unknown } }))

vi.mock('../../history/safe-storage-wrapper', () => ({
  // A class, not an arrow fn — payment-policy does `new SafeStorageWrapper(...)`.
  SafeStorageWrapper: class {
    read = vi.fn(async () => storageBackend.data)
    write = vi.fn(async (data: unknown) => {
      storageBackend.data = data
    })
  },
}))

vi.mock('../../settings', () => ({
  getSetting: vi.fn(),
}))

vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    status: vi.fn(),
  }),
}))

import { PaymentPolicyStore, normalizeToSecondLevel } from '../payment-policy'
import { getSetting } from '../../settings'
import { RATE_LIMIT_BURST_PER_10S, RATE_LIMIT_WINDOW_MS, ONE_DAY_MS } from '../constants'

/** Point getSetting('wallet') at a limits object. '0' means unlimited. */
function setLimits(limits: Partial<{ perRequest: string; perDay: string; perSitePerMonth: string }> = {}): void {
  vi.mocked(getSetting).mockReturnValue({
    limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0', ...limits },
  } as never)
}

/** Move the (faked) wall clock forward without firing interval callbacks. */
function advanceClock(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms))
}

/** Reserve a payment, assert it succeeded, and return its id typed as string. */
function reserve(store: PaymentPolicyStore, domain: string, amount: string): string {
  const id = store.reservePayment(domain, amount)
  expect(id).not.toBeNull()
  return id as string
}

describe('normalizeToSecondLevel', () => {
  it('collapses a subdomain to its second-level domain', () => {
    expect(normalizeToSecondLevel('sub.boards.ton')).toBe('boards.ton')
    expect(normalizeToSecondLevel('a.b.c.evil.com')).toBe('evil.com')
  })

  it('leaves a bare second-level domain unchanged', () => {
    expect(normalizeToSecondLevel('boards.ton')).toBe('boards.ton')
  })

  it('returns an IPv4 address unchanged (must not be split into a 2-level domain)', () => {
    expect(normalizeToSecondLevel('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeToSecondLevel('192.168.1.1')).toBe('192.168.1.1')
  })

  it('returns an IPv6 bracket address unchanged', () => {
    expect(normalizeToSecondLevel('[::1]')).toBe('[::1]')
  })

  it('strips scheme and path before normalizing', () => {
    expect(normalizeToSecondLevel('https://sub.shop.ton/checkout')).toBe('shop.ton')
  })
})

describe('PaymentPolicyStore', () => {
  let store: PaymentPolicyStore

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    storageBackend.data = null
    setLimits()
    store = new PaymentPolicyStore()
    await store.init()
  })

  afterEach(async () => {
    await store.destroy()
    vi.useRealTimers()
  })

  describe('canPay — spending limits', () => {
    it('allows any amount when all limits are 0 (unlimited)', () => {
      expect(store.canPay('shop.ton', '999999999999')).toBe(true)
    })

    it('rejects an amount above the per-request limit', () => {
      setLimits({ perRequest: '5' })
      expect(store.canPay('shop.ton', '6')).toBe(false)
    })

    it('allows an amount exactly at the per-request limit', () => {
      setLimits({ perRequest: '5' })
      expect(store.canPay('shop.ton', '5')).toBe(true)
    })

    it('rejects a payment that would exceed the per-day limit', () => {
      setLimits({ perDay: '10' })
      reserve(store, 'shop.ton', '7')
      advanceClock(1500) // step past the 1/s rate limit
      expect(store.canPay('shop.ton', '4')).toBe(false) // 7 + 4 > 10
    })

    it('allows a payment that exactly reaches the per-day limit', () => {
      setLimits({ perDay: '10' })
      reserve(store, 'shop.ton', '7')
      advanceClock(1500)
      expect(store.canPay('shop.ton', '3')).toBe(true) // 7 + 3 == 10
    })

    it('shares the per-day budget across subdomains of the same site', () => {
      setLimits({ perDay: '10' })
      reserve(store, 'a.shop.ton', '6')
      advanceClock(1500)
      // b.shop.ton normalizes to the same bucket as a.shop.ton
      expect(store.canPay('b.shop.ton', '5')).toBe(false) // 6 + 5 > 10
      expect(store.canPay('b.shop.ton', '4')).toBe(true) // 6 + 4 == 10
    })

    it('rejects a payment that would exceed the per-site-per-month limit', () => {
      setLimits({ perSitePerMonth: '100' })
      reserve(store, 'shop.ton', '60')
      advanceClock(1500)
      expect(store.canPay('shop.ton', '50')).toBe(false) // 60 + 50 > 100
    })
  })

  describe('rate limiting', () => {
    it('rejects a second payment within the same second', () => {
      expect(store.reservePayment('shop.ton', '1')).not.toBeNull()
      expect(store.reservePayment('shop.ton', '1')).toBeNull()
    })

    it('allows another payment once a second has elapsed', () => {
      expect(store.reservePayment('shop.ton', '1')).not.toBeNull()
      advanceClock(1100)
      expect(store.reservePayment('shop.ton', '1')).not.toBeNull()
    })

    it('rejects payments beyond the burst limit inside the 10s window', () => {
      // Space each payment >1s apart so only the burst cap can trigger.
      for (let i = 0; i < RATE_LIMIT_BURST_PER_10S; i++) {
        expect(store.reservePayment('shop.ton', '1')).not.toBeNull()
        advanceClock(1100)
      }
      expect(store.reservePayment('shop.ton', '1')).toBeNull()
    })

    it('allows payments again after the burst window elapses', () => {
      for (let i = 0; i < RATE_LIMIT_BURST_PER_10S; i++) {
        store.reservePayment('shop.ton', '1')
        advanceClock(1100)
      }
      expect(store.reservePayment('shop.ton', '1')).toBeNull()
      advanceClock(RATE_LIMIT_WINDOW_MS)
      expect(store.reservePayment('shop.ton', '1')).not.toBeNull()
    })
  })

  describe('reserve / rollback / confirm', () => {
    it('records the spend and returns a reservation id', () => {
      const id = reserve(store, 'shop.ton', '5')
      expect(typeof id).toBe('string')
      expect(store.getSpending('shop.ton').day).toBe('5')
    })

    it('rollbackPayment removes the spend (a failed payment must not count)', () => {
      const id = reserve(store, 'shop.ton', '5')
      expect(store.getSpending('shop.ton').day).toBe('5')
      store.rollbackPayment(id)
      expect(store.getSpending('shop.ton').day).toBe('0')
    })

    it('rollbackPayment frees the rate-limit slot it consumed', () => {
      const id = reserve(store, 'shop.ton', '1')
      // a second attempt in the same second is rate-limited
      expect(store.reservePayment('shop.ton', '1')).toBeNull()
      store.rollbackPayment(id)
      // the rolled-back attempt no longer counts against the rate limit
      expect(store.reservePayment('shop.ton', '1')).not.toBeNull()
    })

    it('confirmPayment makes the spend permanent (rollback afterwards is a no-op)', () => {
      const id = reserve(store, 'shop.ton', '5')
      store.confirmPayment(id)
      store.rollbackPayment(id)
      expect(store.getSpending('shop.ton').day).toBe('5')
    })
  })

  describe('getSpending', () => {
    it('aggregates the running day and month totals', () => {
      store.reservePayment('shop.ton', '5')
      advanceClock(1500)
      store.reservePayment('shop.ton', '3')
      const spending = store.getSpending('shop.ton')
      expect(spending.day).toBe('8')
      expect(spending.month).toBe('8')
    })

    it('drops payments older than 24h from the day total but keeps them in the month total', () => {
      store.reservePayment('shop.ton', '5')
      advanceClock(ONE_DAY_MS + 1000)
      const spending = store.getSpending('shop.ton')
      expect(spending.day).toBe('0')
      expect(spending.month).toBe('5')
    })
  })

  describe('persistence', () => {
    it('reloads spending recorded by a previous session', async () => {
      const first = new PaymentPolicyStore()
      await first.init()
      expect(first.reservePayment('shop.ton', '5')).not.toBeNull()
      await first.destroy() // flushes spending to storage

      const second = new PaymentPolicyStore()
      await second.init()
      expect(second.getSpending('shop.ton').day).toBe('5')
      await second.destroy()
    })
  })
})
