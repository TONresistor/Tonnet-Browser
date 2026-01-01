import { describe, it, expect } from 'vitest'
import { isValidNavigationUrl, isValidBagId, RateLimiter } from '../validation'

describe('isValidNavigationUrl', () => {
  it('accepts http://example.com', () => {
    const result = isValidNavigationUrl('http://example.com')
    expect(result.valid).toBe(true)
  })

  it('accepts https://example.com', () => {
    const result = isValidNavigationUrl('https://example.com')
    expect(result.valid).toBe(true)
  })

  it('accepts ton://start', () => {
    const result = isValidNavigationUrl('ton://start')
    expect(result.valid).toBe(true)
  })

  it('accepts ton://settings', () => {
    const result = isValidNavigationUrl('ton://settings')
    expect(result.valid).toBe(true)
  })

  it('accepts ton://storage', () => {
    const result = isValidNavigationUrl('ton://storage')
    expect(result.valid).toBe(true)
  })

  it('adds http:// automatically if no scheme (example.com -> http://example.com)', () => {
    const result = isValidNavigationUrl('example.com')
    expect(result.valid).toBe(true)
  })

  it('BLOCKS javascript:alert(1)', () => {
    const result = isValidNavigationUrl('javascript:alert(1)')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('BLOCKS data:text/html,...', () => {
    const result = isValidNavigationUrl('data:text/html,<script>alert(1)</script>')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('BLOCKS file:///etc/passwd', () => {
    const result = isValidNavigationUrl('file:///etc/passwd')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('file:')
  })

  it('BLOCKS vbscript:...', () => {
    const result = isValidNavigationUrl('vbscript:msgbox("xss")')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns error for invalid URL', () => {
    const result = isValidNavigationUrl('not a valid url at all :::')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('isValidBagId', () => {
  it('accepts 64 hex characters (lowercase a-f, 0-9)', () => {
    const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    expect(isValidBagId(validBagId)).toBe(true)
  })

  it('accepts 64 hex characters (uppercase A-F)', () => {
    const validBagId = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'
    expect(isValidBagId(validBagId)).toBe(true)
  })

  it('REJECTS less than 64 characters', () => {
    const shortBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
    expect(isValidBagId(shortBagId)).toBe(false)
  })

  it('REJECTS more than 64 characters', () => {
    const longBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2extra'
    expect(isValidBagId(longBagId)).toBe(false)
  })

  it('REJECTS non-hex characters (g, z, etc)', () => {
    const invalidBagId = 'g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    expect(isValidBagId(invalidBagId)).toBe(false)

    const invalidBagId2 = 'z1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    expect(isValidBagId(invalidBagId2)).toBe(false)
  })

  it('REJECTS empty string', () => {
    expect(isValidBagId('')).toBe(false)
  })

  it('REJECTS null/undefined (returns false, does not crash)', () => {
    expect(isValidBagId(null as unknown as string)).toBe(false)
    expect(isValidBagId(undefined as unknown as string)).toBe(false)
  })
})

describe('RateLimiter', () => {
  it('allows calls within the limit', () => {
    const limiter = new RateLimiter(3, 1000)
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(true)
  })

  it('blocks calls exceeding the limit', () => {
    const limiter = new RateLimiter(2, 1000)
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(false)
  })

  it('resets the call count', () => {
    const limiter = new RateLimiter(1, 1000)
    expect(limiter.check()).toBe(true)
    expect(limiter.check()).toBe(false)
    limiter.reset()
    expect(limiter.check()).toBe(true)
  })
})
