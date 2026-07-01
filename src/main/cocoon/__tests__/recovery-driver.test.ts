import { describe, it, expect } from 'vitest'
import { shouldResendRefund } from '../recovery-driver'

describe('shouldResendRefund', () => {
  const WINDOW = 5 * 60_000

  it('allows the first send (no prior action)', () => {
    expect(shouldResendRefund(undefined, 1_000_000, WINDOW)).toBe(true)
  })

  it('blocks a re-send within the debounce window', () => {
    const now = 10_000_000
    expect(shouldResendRefund(now - (WINDOW - 1), now, WINDOW)).toBe(false)
  })

  it('allows a re-send once the window has elapsed', () => {
    const now = 10_000_000
    expect(shouldResendRefund(now - WINDOW, now, WINDOW)).toBe(true)
    expect(shouldResendRefund(now - (WINDOW + 1), now, WINDOW)).toBe(true)
  })
})
