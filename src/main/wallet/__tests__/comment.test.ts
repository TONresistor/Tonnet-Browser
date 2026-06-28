/**
 * Unit tests for the TON transfer comment codec.
 * encode/decode must stay symmetric: a body produced by encodeCommentBody has
 * to decode back through decodeCommentBody (the same decoder used to read
 * inbound on-chain comments in convertRawTx).
 */

import { describe, it, expect } from 'vitest'
import { beginCell } from '@ton/core'
import { encodeCommentBody, decodeCommentBody, commentByteLength, isCommentWithinLimit } from '../comment'
import { WALLET_MAX_COMMENT_BYTES } from '../../../shared/constants'

/** Encode → BOC base64, the shape the bridge delivers msg.body in. */
function bodyToBase64(text: string): string {
  return encodeCommentBody(text).toBoc().toString('base64')
}

describe('comment codec roundtrip', () => {
  it('roundtrips a short ASCII comment', () => {
    expect(decodeCommentBody(bodyToBase64('hello world'))).toBe('hello world')
  })

  it('roundtrips an exchange-style numeric memo', () => {
    expect(decodeCommentBody(bodyToBase64('1234567890'))).toBe('1234567890')
  })

  it('roundtrips multibyte text (CJK + emoji)', () => {
    const text = '送金ありがとう 🙏 谢谢'
    expect(decodeCommentBody(bodyToBase64(text))).toBe(text)
  })

  it('roundtrips a long comment that snakes across multiple cells', () => {
    const text = 'x'.repeat(200) // > 127 bytes forces a snake ref
    const cell = encodeCommentBody(text)
    expect(cell.refs.length).toBeGreaterThan(0)
    expect(decodeCommentBody(cell.toBoc().toString('base64'))).toBe(text)
  })

  it('roundtrips a comment exactly at the byte cap', () => {
    const text = 'a'.repeat(WALLET_MAX_COMMENT_BYTES)
    expect(decodeCommentBody(bodyToBase64(text))).toBe(text)
  })
})

describe('decodeCommentBody rejects non-comments', () => {
  it('returns undefined for an absent body', () => {
    expect(decodeCommentBody(undefined)).toBeUndefined()
    expect(decodeCommentBody('')).toBeUndefined()
  })

  it('returns undefined for malformed base64', () => {
    expect(decodeCommentBody('not-a-valid-boc')).toBeUndefined()
  })

  it('returns undefined for an empty comment body (op=0, no text)', () => {
    const empty = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64')
    expect(decodeCommentBody(empty)).toBeUndefined()
  })

  it('returns undefined for a non-text-comment opcode', () => {
    // op = 0x12345678 is not the text-comment marker (0)
    const body = beginCell().storeUint(0x12345678, 32).storeStringTail('payload').endCell()
    expect(decodeCommentBody(body.toBoc().toString('base64'))).toBeUndefined()
  })

  it('returns undefined for a body shorter than the 32-bit opcode', () => {
    const tiny = beginCell().storeUint(0, 8).endCell().toBoc().toString('base64')
    expect(decodeCommentBody(tiny)).toBeUndefined()
  })
})

describe('comment byte sizing', () => {
  it('counts UTF-8 bytes, not JS string length', () => {
    expect(commentByteLength('abc')).toBe(3)
    expect(commentByteLength('é')).toBe(2) // 1 char, 2 bytes
    expect(commentByteLength('🙏')).toBe(4) // 1 emoji, 4 bytes
  })

  it('accepts a comment at the cap and rejects one byte over', () => {
    expect(isCommentWithinLimit('a'.repeat(WALLET_MAX_COMMENT_BYTES))).toBe(true)
    expect(isCommentWithinLimit('a'.repeat(WALLET_MAX_COMMENT_BYTES + 1))).toBe(false)
  })

  it('measures multibyte against the byte cap, not the char count', () => {
    // half the cap in 2-byte chars = exactly the cap in bytes
    expect(isCommentWithinLimit('é'.repeat(WALLET_MAX_COMMENT_BYTES / 2))).toBe(true)
    expect(isCommentWithinLimit('é'.repeat(WALLET_MAX_COMMENT_BYTES / 2 + 1))).toBe(false)
  })
})
