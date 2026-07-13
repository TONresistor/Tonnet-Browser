import { describe, expect, it } from 'vitest'
import { BrowserUrlSchema, navigateContract, TabIdSchema, tabHistoryResetContract } from '../browsing'

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
  it('carries the target URL when renderer history is reset', () => {
    expect(tabHistoryResetContract.payload.parse(['tab_1', 'http://second.ton/page'])).toEqual([
      'tab_1',
      'http://second.ton/page',
    ])
  })
  it('uses one URL bound for requests and navigation events', () => {
    const prefix = 'http://example.ton/'
    const boundary = prefix + 'x'.repeat(16_384 - prefix.length)
    expect(BrowserUrlSchema.parse(boundary)).toBe(boundary)
    expect(navigateContract.input.parse([boundary])).toEqual([boundary])
    expect(tabHistoryResetContract.payload.parse(['tab_1', boundary])).toEqual(['tab_1', boundary])
    expect(() => BrowserUrlSchema.parse(`${boundary}x`)).toThrow()
  })
})
