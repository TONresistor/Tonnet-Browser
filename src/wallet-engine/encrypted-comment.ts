import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  timingSafeEqual,
} from 'node:crypto'
import { Address, beginCell, Cell } from '@ton/core'
import { getSecureRandomBytes, hmac_sha512, keyPairFromSeed, sha512 } from '@ton/crypto'

export const ENCRYPTED_COMMENT_OP = 0x2167da4b

const MAX_ENCRYPTED_COMMENT_BYTES = 960
const MAX_ENCRYPTED_PAYLOAD_BYTES = 1024
const CURVE_25519_PRIME = (1n << 255n) - 19n

export interface DecryptCommentRequest {
  sender: string
  body: string
}

export function isEncryptedCommentBody(body?: string): boolean {
  if (!body || body.length > 8192) return false
  try {
    const slice = Cell.fromBase64(body).beginParse()
    return slice.remainingBits >= 32 && slice.loadUint(32) === ENCRYPTED_COMMENT_OP
  } catch {
    return false
  }
}

export function validateEncryptedCommentBody(body: string): Buffer {
  if (!body || body.length > 8192) throw new Error('Invalid encrypted comment body')
  let slice = Cell.fromBase64(body).beginParse()
  if (slice.loadUint(32) !== ENCRYPTED_COMMENT_OP) throw new Error('Invalid encrypted comment opcode')
  const chunks: Buffer[] = []
  let length = 0
  for (;;) {
    if (slice.remainingBits % 8 || slice.remainingRefs > 1) throw new Error('Invalid encrypted comment cells')
    const chunk = slice.loadBuffer(slice.remainingBits / 8)
    length += chunk.length
    if (length > MAX_ENCRYPTED_PAYLOAD_BYTES || chunks.length >= 16) throw new Error('Encrypted comment is too long')
    chunks.push(chunk)
    if (!slice.remainingRefs) break
    slice = slice.loadRef().beginParse()
  }
  if (length < 64 || (length - 48) % 16) throw new Error('Invalid encrypted comment length')
  return Buffer.concat(chunks)
}

export async function decryptEncryptedComment(request: DecryptCommentRequest, secretKey: Buffer): Promise<string> {
  const payload = validateEncryptedCommentBody(request.body)
  const sender = Address.parse(request.sender)
  if (secretKey.length !== 64) throw new Error('Invalid wallet signing key')
  const seed = Buffer.from(secretKey.subarray(0, 32))
  const peer = xor32(payload.subarray(0, 32), secretKey.subarray(32, 64))
  let shared: Buffer | undefined
  let derived: Buffer | undefined
  let plaintext: Buffer | undefined
  let authentication: Buffer | undefined
  try {
    const messageKey = payload.subarray(32, 48)
    shared = await deriveTonSharedSecret(peer, seed)
    derived = Buffer.from(await hmac_sha512(shared, messageKey))
    const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
    decipher.setAutoPadding(false)
    plaintext = Buffer.concat([decipher.update(payload.subarray(48)), decipher.final()])
    const salt = sender.toString({ bounceable: true, testOnly: false, urlSafe: true })
    authentication = Buffer.from(await hmac_sha512(salt, plaintext))
    if (!timingSafeEqual(authentication.subarray(0, 16), messageKey))
      throw new Error('Encrypted comment authentication failed')
    const prefix = plaintext[0]
    if (
      prefix < 16 ||
      prefix > 31 ||
      prefix > plaintext.length ||
      plaintext.length - prefix > MAX_ENCRYPTED_COMMENT_BYTES
    )
      throw new Error('Invalid encrypted comment padding')
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext.subarray(prefix))
  } finally {
    seed.fill(0)
    shared?.fill(0)
    derived?.fill(0)
    plaintext?.fill(0)
    authentication?.fill(0)
  }
}

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
  const senderKeys = keyPairFromSeed(senderSeed)
  const senderPublicKey = senderKeys.publicKey
  senderKeys.secretKey.fill(0)
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
    comment.fill(0)
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
  const signBit = peerPublicKey[31] >> 7
  const ySquared = mod(y * y)
  const denominator = mod(mod(-121665n * inv(121666n)) * ySquared + 1n)
  const xSquared = mod((ySquared - 1n) * inv(denominator))
  if (
    y >= CURVE_25519_PRIME ||
    denominator === 0n ||
    (xSquared === 0n ? signBit !== 0 : modPow(xSquared, (CURVE_25519_PRIME - 1n) / 2n) !== 1n)
  )
    throw new Error('Invalid peer public key')
  const u = mod((y + 1n) * inv(1n - y))
  const hash = await sha512(privateSeed)
  const scalar = Buffer.from(hash.subarray(0, 32))
  scalar[0] &= 248
  scalar[31] = (scalar[31] & 127) | 64
  const privateDer = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), scalar])
  try {
    const privateKey = createPrivateKey({ key: privateDer, format: 'der', type: 'pkcs8' })
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), bigIntToLe(u, 32)]),
      format: 'der',
      type: 'spki',
    })
    const shared = diffieHellman({ privateKey, publicKey })
    if (shared.every((byte) => byte === 0)) throw new Error('Invalid peer public key')
    return shared
  } catch {
    throw new Error('Invalid peer public key')
  } finally {
    privateDer.fill(0)
    scalar.fill(0)
    hash.fill(0)
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
