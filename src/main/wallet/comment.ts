/**
 * TON transfer comment (memo) codec.
 *
 * A text comment is the standard TEP message body: a 32-bit zero opcode
 * followed by the comment text in snake format (chunked across cell refs for
 * strings longer than one cell). encode/decode here are the symmetric pair and
 * are kept together so they cannot drift.
 */

import { beginCell, Cell } from '@ton/core'
import { WALLET_MAX_COMMENT_BYTES } from '../../shared/constants'

/** Build a standard text-comment message body (op=0 + snake string). */
export function encodeCommentBody(text: string): Cell {
  return beginCell().storeUint(0, 32).storeStringTail(text).endCell()
}

/**
 * Decode a base64 BOC message body as a text comment.
 * Returns undefined when the body is absent, not a text comment (op !== 0),
 * malformed, or empty.
 */
export function decodeCommentBody(body?: string): string | undefined {
  if (!body) return undefined
  try {
    const slice = Cell.fromBase64(body).beginParse()
    if (slice.remainingBits < 32) return undefined
    if (slice.loadUint(32) !== 0) return undefined
    const text = slice.loadStringTail()
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

/** UTF-8 byte length of a comment — the unit the on-chain cap is measured in. */
export function commentByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** True when the comment fits within WALLET_MAX_COMMENT_BYTES. */
export function isCommentWithinLimit(text: string): boolean {
  return commentByteLength(text) <= WALLET_MAX_COMMENT_BYTES
}

export function normalizeComment(comment?: string): string | undefined {
  if (typeof comment !== 'string') return undefined
  const trimmed = comment.trim()
  if (!trimmed) return undefined
  if (!isCommentWithinLimit(trimmed)) throw new Error('Comment exceeds maximum length')
  return trimmed
}
