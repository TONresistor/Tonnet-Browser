/**
 * Ed25519 to X25519 conversion for the ton-simple-v2 envelope.
 *
 * `@noble/curves` v2 dropped the `edwardsToMontgomery*` helpers that v1
 * exposed, so they are restored here using the same formulas over the v2
 * field. Going through noble rather than a hand-rolled ladder buys point
 * validation, a constant-time scalar multiply, and rejection of the all-zero
 * shared secret that a low-order peer key would otherwise produce.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { sha512 } from '@ton/crypto'

/** RFC 7748 scalar clamping, matching noble's own `adjustScalarBytes`. */
function clampScalar(bytes: Uint8Array): Uint8Array {
  const clamped = new Uint8Array(bytes)
  clamped[0] &= 248
  clamped[31] &= 127
  clamped[31] |= 64
  return clamped
}

/**
 * Map an Ed25519 public key to its Montgomery u-coordinate: u = (1 + y) / (1 - y).
 * Throws when the key is not a valid curve point.
 */
export function edwardsToMontgomeryPublicKey(edwardsPublicKey: Uint8Array): Uint8Array {
  const point = ed25519.Point.fromBytes(edwardsPublicKey)
  const field = ed25519.Point.Fp
  return field.toBytes(field.create(field.mul(field.add(1n, point.y), field.inv(field.sub(1n, point.y)))))
}

/**
 * Derive the X25519 shared secret between our wallet seed and a peer's
 * Ed25519 public key. The seed is hashed and clamped exactly as Ed25519 key
 * generation does, so the secret matches what any other TON wallet computes.
 */
export async function deriveSharedSecret(seed: Uint8Array, peerPublicKey: Uint8Array): Promise<Buffer> {
  if (seed.length < 32) throw new Error('seed must be at least 32 bytes')
  if (peerPublicKey.length !== 32) throw new Error('peerPublicKey must be 32 bytes')

  const hashed = await sha512(Buffer.from(seed.subarray(0, 32)))
  const scalar = clampScalar(hashed.subarray(0, 32))
  try {
    return Buffer.from(x25519.getSharedSecret(scalar, edwardsToMontgomeryPublicKey(peerPublicKey)))
  } finally {
    scalar.fill(0)
    hashed.fill(0)
  }
}
