import { createCipheriv } from 'node:crypto'
import { Address, beginCell, type Cell } from '@ton/core'
import { getSecureRandomBytes, hmac_sha512, keyPairFromSeed, sha512 } from '@ton/crypto'

export const ENCRYPTED_COMMENT_OP = 0x2167da4b

const MAX_ENCRYPTED_COMMENT_BYTES = 960
const MAX_ENCRYPTED_PAYLOAD_BYTES = 1024
const CURVE_25519_PRIME = (1n << 255n) - 19n

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

export async function createEncryptedCommentBody(args: {
  senderAddress: Address
  senderSecretKey: Buffer
  recipientPublicKey: Buffer
  comment: string | Buffer
}): Promise<Cell> {
  if (args.senderSecretKey.length < 32) throw new Error('senderSecretKey must contain a 32-byte seed')
  if (args.recipientPublicKey.length !== 32) throw new Error('recipientPublicKey must be 32 bytes')

  const comment = typeof args.comment === 'string' ? Buffer.from(args.comment, 'utf8') : Buffer.from(args.comment)
  if (comment.length > MAX_ENCRYPTED_COMMENT_BYTES) {
    throw new Error(`Encrypted comment plaintext must be <= ${MAX_ENCRYPTED_COMMENT_BYTES} bytes`)
  }

  const senderSeed = Buffer.from(args.senderSecretKey.subarray(0, 32))
  const senderPublicKey = Buffer.from(keyPairFromSeed(senderSeed).publicKey)
  const recipientPublicKey = Buffer.from(args.recipientPublicKey)
  let sharedSecret: Buffer | undefined
  let derived: Buffer | undefined

  try {
    const prefixLength = ((16 + 15 + comment.length) & ~15) - comment.length
    const prefix = Buffer.from(await getSecureRandomBytes(prefixLength))
    prefix[0] = prefixLength
    const paddedData = Buffer.concat([prefix, comment])
    const salt = Buffer.from(args.senderAddress.toString({ bounceable: true, testOnly: false, urlSafe: true }), 'utf8')

    sharedSecret = await deriveTonSharedSecret(recipientPublicKey, senderSeed)
    const msgKey = Buffer.from(await hmac_sha512(salt, paddedData)).subarray(0, 16)
    derived = Buffer.from(await hmac_sha512(sharedSecret, msgKey))
    const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
    cipher.setAutoPadding(false)
    const ciphertext = Buffer.concat([cipher.update(paddedData), cipher.final()])

    return encryptedCommentToCell(Buffer.concat([xor32(senderPublicKey, recipientPublicKey), msgKey, ciphertext]))
  } finally {
    senderSeed.fill(0)
    sharedSecret?.fill(0)
    derived?.fill(0)
  }
}

export async function deriveTonSharedSecret(peerPublicKey: Buffer, privateSeed: Buffer): Promise<Buffer> {
  if (peerPublicKey.length !== 32) throw new Error('peerPublicKey must be 32 bytes')
  if (privateSeed.length !== 32) throw new Error('privateSeed must be 32 bytes')

  const publicY = Buffer.from(peerPublicKey)
  publicY[31] &= 127
  const y = leToBigInt(publicY)
  const u = mod((y + 1n) * inv(1n - y))
  const hash = await sha512(privateSeed)
  const scalar = Buffer.from(hash.subarray(0, 32))
  try {
    return x25519(scalar, bigIntToLe(u, 32))
  } finally {
    scalar.fill(0)
  }
}

function mod(value: bigint): bigint {
  const reduced = value % CURVE_25519_PRIME
  return reduced >= 0n ? reduced : reduced + CURVE_25519_PRIME
}

function modPow(value: bigint, exponent: bigint): bigint {
  let base = mod(value)
  let result = 1n
  while (exponent > 0n) {
    if (exponent & 1n) result = mod(result * base)
    base = mod(base * base)
    exponent >>= 1n
  }
  return result
}

function inv(value: bigint): bigint {
  return modPow(value, CURVE_25519_PRIME - 2n)
}

function leToBigInt(bytes: Buffer): bigint {
  let value = 0n
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = (value << 8n) + BigInt(bytes[index])
  }
  return value
}

function bigIntToLe(value: bigint, size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let index = 0; index < size; index++) {
    bytes[index] = Number(value & 255n)
    value >>= 8n
  }
  return bytes
}

function x25519(scalar: Buffer, uBytes: Buffer): Buffer {
  const clamped = Buffer.from(scalar)
  clamped[0] &= 248
  clamped[31] &= 127
  clamped[31] |= 64

  const x1 = leToBigInt(uBytes)
  let x2 = 1n
  let z2 = 0n
  let x3 = x1
  let z3 = 1n
  let swap = 0n
  const scalarNumber = leToBigInt(clamped)

  for (let bit = 254; bit >= 0; bit--) {
    const scalarBit = (scalarNumber >> BigInt(bit)) & 1n
    swap ^= scalarBit
    if (swap) {
      const previousX2 = x2
      const previousZ2 = z2
      x2 = x3
      z2 = z3
      x3 = previousX2
      z3 = previousZ2
    }
    swap = scalarBit

    const a = mod(x2 + z2)
    const aa = mod(a * a)
    const b = mod(x2 - z2)
    const bb = mod(b * b)
    const e = mod(aa - bb)
    const c = mod(x3 + z3)
    const d = mod(x3 - z3)
    const da = mod(d * a)
    const cb = mod(c * b)
    const daPlusCb = mod(da + cb)
    const daMinusCb = mod(da - cb)

    x3 = mod(daPlusCb * daPlusCb)
    z3 = mod(x1 * mod(daMinusCb * daMinusCb))
    x2 = mod(aa * bb)
    z2 = mod(e * mod(aa + 121665n * e))
  }

  if (swap) {
    const previousX2 = x2
    const previousZ2 = z2
    x2 = x3
    z2 = z3
    x3 = previousX2
    z3 = previousZ2
  }
  clamped.fill(0)
  return bigIntToLe(mod(x2 * inv(z2)), 32)
}

function xor32(left: Buffer, right: Buffer): Buffer {
  if (left.length !== 32 || right.length !== 32) throw new Error('Expected 32-byte public keys')
  const result = Buffer.alloc(32)
  for (let index = 0; index < 32; index++) result[index] = left[index] ^ right[index]
  return result
}

function encryptedCommentToCell(encryptedComment: Buffer): Cell {
  if (encryptedComment.length > MAX_ENCRYPTED_PAYLOAD_BYTES) throw new Error('Encrypted comment is too long')

  const chunks: Buffer[] = [encryptedComment.subarray(0, 35)]
  for (let offset = 35; offset < encryptedComment.length; offset += 127) {
    chunks.push(encryptedComment.subarray(offset, offset + 127))
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
