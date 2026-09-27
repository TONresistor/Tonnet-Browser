/**
 * The ton-simple-v2 cipher envelope, independent of how it is transported.
 *
 * Layout: (myPub XOR peerPub) || msgKey[16] || AES-256-CBC(padded)
 *
 *   padded = randomPrefix || plaintext, aligned to 16 bytes, prefix >= 16 bytes
 *            with prefix[0] holding its own length
 *   salt   = the bounceable address of whoever encrypted the payload
 *   msgKey = HMAC-SHA512(salt, padded)[0:16]
 *   key/iv = HMAC-SHA512(sharedSecret, msgKey) split at 32 and 48
 *
 * encrypt and decrypt live together so the padding and key schedule cannot
 * drift apart. `msgKey` doubles as the integrity tag: decrypt recomputes it
 * over the recovered plaintext and compares in constant time, which binds the
 * ciphertext to the salt and makes a wrong sender address fail closed.
 *
 * This matches tonlib SimpleEncryptionV2, so payloads interoperate with other
 * TON wallets. See docs/ENCRYPTION.md.
 */

import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import type { Address } from '@ton/core'
import { getSecureRandomBytes, hmac_sha512, keyPairFromSeed } from '@ton/crypto'
import { deriveSharedSecret } from './x25519'

/** Smallest random prefix; also the smallest legal value of prefix[0]. */
const MIN_PADDING_BYTES = 16
const AES_BLOCK_BYTES = 16
const PUBLIC_KEY_BYTES = 32
const MSG_KEY_BYTES = 16
/** Public-key difference plus msgKey; everything after this is ciphertext. */
export const ENVELOPE_HEADER_BYTES = PUBLIC_KEY_BYTES + MSG_KEY_BYTES

/** Source of the random padding prefix. Overridden by known-answer tests. */
export type RandomSource = (size: number) => Promise<Uint8Array> | Uint8Array

/** The salt is the sender's address in bounceable, URL-safe, mainnet form. */
export function addressSalt(address: Address): Buffer {
  return Buffer.from(address.toString({ bounceable: true, testOnly: false, urlSafe: true }), 'utf8')
}

function xorPublicKeys(left: Uint8Array, right: Uint8Array): Buffer {
  if (left.length !== PUBLIC_KEY_BYTES || right.length !== PUBLIC_KEY_BYTES) {
    throw new Error('Expected 32-byte public keys')
  }
  const result = Buffer.alloc(PUBLIC_KEY_BYTES)
  for (let index = 0; index < PUBLIC_KEY_BYTES; index++) result[index] = left[index] ^ right[index]
  return result
}

/** Length of the random prefix that pads `plaintextLength` to a block boundary. */
function prefixLengthFor(plaintextLength: number): number {
  return ((MIN_PADDING_BYTES + AES_BLOCK_BYTES - 1 + plaintextLength) & ~(AES_BLOCK_BYTES - 1)) - plaintextLength
}

/** Total envelope size for a given plaintext, without encrypting anything. */
export function envelopeLengthFor(plaintextLength: number): number {
  return ENVELOPE_HEADER_BYTES + prefixLengthFor(plaintextLength) + plaintextLength
}

async function deriveCipherParameters(sharedSecret: Buffer, msgKey: Buffer): Promise<Buffer> {
  return Buffer.from(await hmac_sha512(sharedSecret, msgKey))
}

/**
 * Encrypt `plaintext` for `peerPublicKey`, salted with the sender's address.
 *
 * `senderSeed` is the 32-byte wallet seed; a 64-byte secret key is accepted
 * and truncated, matching how nacl-style keys are stored.
 */
export async function encryptEnvelope(args: {
  plaintext: Uint8Array
  senderAddress: Address
  senderSeed: Uint8Array
  peerPublicKey: Uint8Array
  randomSource?: RandomSource
}): Promise<Buffer> {
  if (args.senderSeed.length < 32) throw new Error('senderSeed must contain a 32-byte seed')
  if (args.peerPublicKey.length !== PUBLIC_KEY_BYTES) throw new Error('peerPublicKey must be 32 bytes')

  const seed = Buffer.from(args.senderSeed.subarray(0, 32))
  const senderPublicKey = Buffer.from(keyPairFromSeed(seed).publicKey)
  const peerPublicKey = Buffer.from(args.peerPublicKey)
  const random = args.randomSource ?? getSecureRandomBytes

  let sharedSecret: Buffer | undefined
  let cipherParameters: Buffer | undefined
  let padded: Buffer | undefined

  try {
    const prefixLength = prefixLengthFor(args.plaintext.length)
    const prefix = Buffer.from(await random(prefixLength))
    if (prefix.length !== prefixLength) throw new Error('Random source returned the wrong length')
    prefix[0] = prefixLength
    padded = Buffer.concat([prefix, Buffer.from(args.plaintext)])

    sharedSecret = await deriveSharedSecret(seed, peerPublicKey)
    const msgKey = Buffer.from(await hmac_sha512(addressSalt(args.senderAddress), padded)).subarray(0, MSG_KEY_BYTES)
    cipherParameters = await deriveCipherParameters(sharedSecret, msgKey)

    const cipher = createCipheriv('aes-256-cbc', cipherParameters.subarray(0, 32), cipherParameters.subarray(32, 48))
    cipher.setAutoPadding(false)
    const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()])

    return Buffer.concat([xorPublicKeys(senderPublicKey, peerPublicKey), msgKey, ciphertext])
  } finally {
    seed.fill(0)
    sharedSecret?.fill(0)
    cipherParameters?.fill(0)
    padded?.fill(0)
  }
}

/**
 * Decrypt an envelope addressed to us. `senderAddress` is whoever encrypted it
 * and must match the salt used at encryption time, otherwise the msgKey check
 * fails. Returns the plaintext with the random prefix stripped.
 */
export async function decryptEnvelope(args: {
  envelope: Uint8Array
  senderAddress: Address
  recipientSeed: Uint8Array
}): Promise<Buffer> {
  if (args.recipientSeed.length < 32) throw new Error('recipientSeed must contain a 32-byte seed')

  const envelope = Buffer.from(args.envelope)
  if (envelope.length < ENVELOPE_HEADER_BYTES + AES_BLOCK_BYTES) throw new Error('Encrypted payload is too short')
  const ciphertext = envelope.subarray(ENVELOPE_HEADER_BYTES)
  if (ciphertext.length % AES_BLOCK_BYTES !== 0) {
    throw new Error('Encrypted payload is not a multiple of the block size')
  }

  const seed = Buffer.from(args.recipientSeed.subarray(0, 32))
  const recipientPublicKey = Buffer.from(keyPairFromSeed(seed).publicKey)

  let sharedSecret: Buffer | undefined
  let cipherParameters: Buffer | undefined
  let padded: Buffer | undefined

  try {
    // The header stores the XOR of both keys, so our own key recovers the peer's.
    const peerPublicKey = xorPublicKeys(envelope.subarray(0, PUBLIC_KEY_BYTES), recipientPublicKey)
    const msgKey = envelope.subarray(PUBLIC_KEY_BYTES, ENVELOPE_HEADER_BYTES)

    sharedSecret = await deriveSharedSecret(seed, peerPublicKey)
    cipherParameters = await deriveCipherParameters(sharedSecret, msgKey)

    const decipher = createDecipheriv(
      'aes-256-cbc',
      cipherParameters.subarray(0, 32),
      cipherParameters.subarray(32, 48)
    )
    decipher.setAutoPadding(false)
    padded = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    const expectedMsgKey = Buffer.from(await hmac_sha512(addressSalt(args.senderAddress), padded)).subarray(
      0,
      MSG_KEY_BYTES
    )
    if (!timingSafeEqual(expectedMsgKey, msgKey)) {
      throw new Error('Failed to decrypt: authentication failed')
    }

    const prefixLength = padded[0]
    if (prefixLength < MIN_PADDING_BYTES || prefixLength > padded.length) {
      throw new Error('Failed to decrypt: invalid padding')
    }
    return Buffer.from(padded.subarray(prefixLength))
  } finally {
    seed.fill(0)
    sharedSecret?.fill(0)
    cipherParameters?.fill(0)
    padded?.fill(0)
  }
}
