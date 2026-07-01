import { describe, it, expect } from 'vitest'
import { decodeUtf8Prefix } from '../decode-utf8'

describe('decodeUtf8Prefix', () => {
  it('decodes a complete UTF-8 buffer unchanged', () => {
    expect(decodeUtf8Prefix(Buffer.from('héllo — 🚀', 'utf8'))).toBe('héllo — 🚀')
  })

  it('drops an incomplete trailing multibyte sequence instead of emitting U+FFFD', () => {
    const full = Buffer.from('café', 'utf8') // 'é' is 2 bytes (0xC3 0xA9)
    const cut = full.subarray(0, full.length - 1) // splits 'é' mid-codepoint
    const out = decodeUtf8Prefix(cut)
    expect(out).toBe('caf')
    expect(out).not.toContain('�')
  })

  it('drops a split 4-byte emoji cleanly', () => {
    const full = Buffer.from('ok🚀', 'utf8') // rocket is 4 bytes
    const cut = full.subarray(0, full.length - 2)
    expect(decodeUtf8Prefix(cut)).toBe('ok')
  })
})
