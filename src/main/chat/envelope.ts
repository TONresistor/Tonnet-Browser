import { createHash } from 'node:crypto'
import { keyPairFromSeed, sign, signVerify } from '@ton/crypto'

const TAG_V1 = 'tonnet-envelope-v1'
const TAG_V2 = 'tonnet-envelope-v2'

export interface WireEnvelope {
  type: string
  nick: string
  text: string
  ts: number
  room?: string
  key?: string
  sig?: string
  wkey?: string
  wsig?: string
  wts?: number
  wexp?: number
}

export type EnvelopeStatus = 'unsigned' | 'valid' | 'invalid'

function field(b: Buffer): Buffer {
  const l = Buffer.alloc(4)
  l.writeUInt32BE(b.length, 0)
  return Buffer.concat([l, b])
}

function u64be(n: number): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(n), 0)
  return b
}

function hexBuf(s: string | undefined, bytes: number): Buffer | null {
  if (!s || s.length !== bytes * 2 || !/^[0-9a-fA-F]+$/.test(s)) return null
  return Buffer.from(s, 'hex')
}

function hasProofFields(e: WireEnvelope): boolean {
  return Boolean(e.wkey || e.wsig || e.wts || e.wexp)
}

export function proofBlock(e: WireEnvelope): Buffer | null {
  if (!e.wkey) {
    if (hasProofFields(e)) throw new Error('malformed proof fields')
    return null
  }
  const wkey = hexBuf(e.wkey, 32)
  const wsig = hexBuf(e.wsig, 64)
  if (!wkey || !wsig || !e.wts || e.wts <= 0 || !e.wexp || e.wexp <= 0) {
    throw new Error('malformed proof fields')
  }
  return Buffer.concat([wkey, u64be(e.wts), u64be(e.wexp), wsig])
}

export function envelopeDigest(e: WireEnvelope, pub: Buffer): Buffer {
  const h = createHash('sha256')
  if (!e.room) {
    if (hasProofFields(e)) throw new Error('malformed proof fields')
    h.update(field(Buffer.from(TAG_V1, 'utf8')))
    h.update(field(Buffer.from(e.type, 'utf8')))
    h.update(field(Buffer.from(e.nick, 'utf8')))
    h.update(field(Buffer.from(e.text, 'utf8')))
    h.update(field(Buffer.from(String(e.ts), 'utf8')))
    h.update(field(pub))
    return h.digest()
  }
  const block = proofBlock(e) ?? Buffer.alloc(0)
  h.update(field(Buffer.from(TAG_V2, 'utf8')))
  h.update(field(Buffer.from(e.type, 'utf8')))
  h.update(field(Buffer.from(e.nick, 'utf8')))
  h.update(field(Buffer.from(e.text, 'utf8')))
  h.update(field(Buffer.from(String(e.ts), 'utf8')))
  h.update(field(Buffer.from(e.room, 'utf8')))
  h.update(field(pub))
  h.update(field(block))
  return h.digest()
}

export function signEnvelope(e: WireEnvelope, deviceSeed: Buffer): WireEnvelope {
  const kp = keyPairFromSeed(deviceSeed)
  const digest = envelopeDigest(e, kp.publicKey)
  const sig = sign(digest, kp.secretKey)
  return { ...e, key: kp.publicKey.toString('hex'), sig: sig.toString('hex') }
}

export function verifyEnvelope(e: WireEnvelope): EnvelopeStatus {
  if (!e.key && !e.sig) return hasProofFields(e) ? 'invalid' : 'unsigned'
  const pub = hexBuf(e.key, 32)
  const sig = hexBuf(e.sig, 64)
  if (!pub || !sig) return 'invalid'
  let digest: Buffer
  try {
    digest = envelopeDigest(e, pub)
  } catch {
    return 'invalid'
  }
  return signVerify(digest, sig, pub) ? 'valid' : 'invalid'
}

export function fingerprint(e: WireEnvelope): string {
  return e.key && e.key.length >= 8 ? e.key.slice(0, 8) : ''
}

export function devicePublicKeyHex(deviceSeed: Buffer): string {
  return keyPairFromSeed(deviceSeed).publicKey.toString('hex')
}
