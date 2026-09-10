/**
 * On-chain transport for the encrypted-comment envelope.
 *
 * A body is the 32-bit opcode 0x2167da4b followed by the envelope in snake
 * form: 35 bytes in the root cell, then 127 bytes per reference. That 35-byte
 * root is the layout every TON wallet expects, so a generic string-tail
 * encoder (which would fill the root with 127 bytes) is not a substitute.
 *
 * encode and decode are kept together so they cannot drift, the same reason
 * comment.ts pairs its own codec.
 */

import { beginCell, Cell } from '@ton/core'

export const ENCRYPTED_COMMENT_OP = 0x2167da4b

/** Bytes carried inline in the root cell, after the 32-bit opcode. */
const ROOT_CHUNK_BYTES = 35
/** Bytes carried by each reference cell. */
const REF_CHUNK_BYTES = 127
/** Ceiling on the encoded envelope, bounding the reference chain. */
const MAX_ENVELOPE_BYTES = 1024

/** Wrap an envelope in an encrypted-comment message body. */
export function encodeEncryptedCommentBody(envelope: Uint8Array): Cell {
  if (envelope.length > MAX_ENVELOPE_BYTES) throw new Error('Encrypted comment is too long')

  const payload = Buffer.from(envelope)
  const chunks: Buffer[] = [payload.subarray(0, ROOT_CHUNK_BYTES)]
  for (let offset = ROOT_CHUNK_BYTES; offset < payload.length; offset += REF_CHUNK_BYTES) {
    chunks.push(payload.subarray(offset, offset + REF_CHUNK_BYTES))
  }

  let reference: Cell | null = null
  for (let index = chunks.length - 1; index >= 1; index--) {
    const builder = beginCell().storeBuffer(chunks[index])
    if (reference) builder.storeRef(reference)
    reference = builder.endCell()
  }

  const root = beginCell().storeUint(ENCRYPTED_COMMENT_OP, 32).storeBuffer(chunks[0])
  if (reference) root.storeRef(reference)
  return root.endCell()
}

/** True when a base64 message body carries the encrypted-comment opcode. */
export function isEncryptedCommentBody(body?: string): boolean {
  if (!body) return false
  try {
    const slice = Cell.fromBase64(body).beginParse()
    if (slice.remainingBits < 32) return false
    return slice.loadUint(32) === ENCRYPTED_COMMENT_OP
  } catch {
    return false
  }
}

/**
 * Recover the envelope from a base64 message body. Returns undefined when the
 * body is absent, malformed, or carries a different opcode, so callers can
 * treat "not an encrypted comment" the same as "no comment".
 */
export function decodeEncryptedCommentBody(body?: string): Buffer | undefined {
  if (!body) return undefined
  try {
    let slice = Cell.fromBase64(body).beginParse()
    if (slice.remainingBits < 32) return undefined
    if (slice.loadUint(32) !== ENCRYPTED_COMMENT_OP) return undefined

    const chunks: Buffer[] = []
    for (;;) {
      if (slice.remainingBits % 8 !== 0) return undefined
      chunks.push(slice.loadBuffer(slice.remainingBits / 8))
      if (slice.remainingRefs === 0) break
      slice = slice.loadRef().beginParse()
    }
    const envelope = Buffer.concat(chunks)
    return envelope.length > 0 ? envelope : undefined
  } catch {
    return undefined
  }
}
