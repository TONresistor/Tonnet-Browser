import { describe, expect, it } from 'vitest'
import { navigateContract, TabIdSchema } from '../browsing'

describe('browsing IPC contracts', () => {
  it('bounds and restricts renderer-provided tab ids', () => {
    expect(TabIdSchema.parse('a1b2c3d')).toBe('a1b2c3d')
    expect(() => TabIdSchema.parse('../escape')).toThrow()
    expect(() => TabIdSchema.parse('')).toThrow()
  })
  it('declares navigation throttling and bounds URL input', () => {
    expect(navigateContract.rateLimit).toEqual({ kind: 'fixed-window', maxRequests: 30, windowMs: 1000, key: 'sender' })
    expect(navigateContract.input.parse(['https://example.com', 'tab_1'])).toHaveLength(2)
    expect(() => navigateContract.input.parse(['x'.repeat(16_385)])).toThrow()
  })
})
