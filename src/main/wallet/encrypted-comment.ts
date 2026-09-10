/**
 * Encrypted transfer memos: the on-chain face of the ton-simple-v2 envelope.
 *
 * The cipher itself lives in ton-encryption/, transport free, so the same
 * construction serves both memos and TON Connect payloads. This module only
 * adds what is specific to memos: the recipient key lookup format and the
 * message-body cell. See docs/ENCRYPTION.md.
 */

import type { Address } from '@ton/core'
import type { Cell } from '@ton/core'
import { decodeEncryptedCommentBody, encodeEncryptedCommentBody } from './ton-encryption/comment-body'
import { decryptEnvelope, encryptEnvelope, type RandomSource } from './ton-encryption/envelope'

export { ENCRYPTED_COMMENT_OP, decodeEncryptedCommentBody, isEncryptedCommentBody } from './ton-encryption/comment-body'
export { addressSalt, decryptEnvelope, encryptEnvelope } from './ton-encryption/envelope'
export { deriveSharedSecret } from './ton-encryption/x25519'

/**
 * Largest memo the cipher module accepts. The send path caps user input at
 * WALLET_MAX_COMMENT_BYTES well below this; the headroom exists so non-memo
 * callers are not silently truncated.
 */
const MAX_ENCRYPTED_COMMENT_BYTES = 960

/** Read a 32-byte Ed25519 key out of a `get_public_key` stack result. */
export function parseRecipientPublicKey(result: unknown): Buffer {
  if (!result || typeof result !== 'object') throw new Error('get_public_key returned no result')
  const response = result as { stack?: unknown[]; exit_code?: unknown }
  if (response.exit_code !== undefined && response.exit_code !== 0 && response.exit_code !== 1) {
    throw new Error(`get_public_key failed with exit_code=${String(response.exit_code)}`)
  }
  const value = response.stack?.[0]
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('get_public_key returned an invalid stack value')
  }
  const publicKey = BigInt(value)
  if (publicKey <= 0n || publicKey >= 1n << 256n) {
    throw new Error('get_public_key returned an invalid public key')
  }
  return Buffer.from(publicKey.toString(16).padStart(64, '0'), 'hex')
}

/** Build an encrypted-comment message body addressed to `recipientPublicKey`. */
export async function createEncryptedCommentBody(args: {
  senderAddress: Address
  senderSecretKey: Buffer
  recipientPublicKey: Buffer
  comment: string | Buffer
  randomSource?: RandomSource
}): Promise<Cell> {
  const comment = typeof args.comment === 'string' ? Buffer.from(args.comment, 'utf8') : Buffer.from(args.comment)
  if (comment.length > MAX_ENCRYPTED_COMMENT_BYTES) {
    throw new Error(`Encrypted comment plaintext must be <= ${MAX_ENCRYPTED_COMMENT_BYTES} bytes`)
  }

  const envelope = await encryptEnvelope({
    plaintext: comment,
    senderAddress: args.senderAddress,
    senderSeed: args.senderSecretKey,
    peerPublicKey: args.recipientPublicKey,
    randomSource: args.randomSource,
  })
  return encodeEncryptedCommentBody(envelope)
}

/**
 * Recover the plaintext of an encrypted memo.
 *
 * `senderAddress` is whoever sent the message: the counterparty for a received
 * transfer, our own address for one we sent. Any other address fails the
 * authentication check rather than returning garbage.
 */
export async function decryptCommentBody(args: {
  body: string
  senderAddress: Address
  recipientSecretKey: Buffer
}): Promise<string> {
  const envelope = decodeEncryptedCommentBody(args.body)
  if (!envelope) throw new Error('Message body is not an encrypted comment')
  const plaintext = await decryptEnvelope({
    envelope,
    senderAddress: args.senderAddress,
    recipientSeed: args.recipientSecretKey,
  })
  return plaintext.toString('utf8')
}
