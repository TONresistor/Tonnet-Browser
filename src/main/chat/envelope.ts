import { createHash } from 'node:crypto'
import { keyPairFromSeed, sign, signVerify } from '@ton/crypto'

const ENVELOPE_V4_MAGIC = Buffer.from([0xc8, 0x18, 0x85, 0xc4])
const ENVELOPE_V4_TOSIGN_MAGIC = Buffer.from([0x92, 0x08, 0xdb, 0xb8])

const ZERO_KEY = Buffer.alloc(32)
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)

export const ENVELOPE_DOMAIN = 'tonnet.envelopeV4'
export const MAX_TYPE_BYTES = 16
export const MAX_NICK_BYTES = 64
export const MAX_TEXT_BYTES = 2048
export const MAX_ROOM_BYTES = 256
export const MAX_TO_BYTES = 64

export interface WireEnvelope {
  type: string
  nick: string
  text: string
  ts: number
  room?: string
  to?: string
  key?: string
  sig?: string
  wkey?: string
  wsig?: string
  wts?: number
  wexp?: number
}

export type EnvelopeStatus = 'unsigned' | 'valid' | 'invalid'

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

function byteLen(s: string | undefined): number {
  return Buffer.byteLength(s ?? '', 'utf8')
}

function tlBytes(data: Buffer): Buffer {
  let prefix: Buffer
  if (data.length < 254) {
    prefix = Buffer.from([data.length])
  } else {
    prefix = Buffer.alloc(4)
    prefix[0] = 0xfe
    prefix.writeUIntLE(data.length, 1, 3)
  }
  const unpadded = prefix.length + data.length
  const pad = (4 - (unpadded % 4)) % 4
  return Buffer.concat([prefix, data, Buffer.alloc(pad)])
}

function readTlBytes(buf: Buffer, off: number): { value: Buffer; next: number } {
  if (off >= buf.length) throw new Error('envelope: truncated bytes')
  const first = buf[off]
  let len: number
  let header: number
  if (first < 254) {
    len = first
    header = 1
  } else {
    if (off + 4 > buf.length) throw new Error('envelope: truncated long bytes header')
    len = buf.readUIntLE(off + 1, 3)
    header = 4
  }
  const start = off + header
  if (start + len > buf.length) throw new Error('envelope: bytes exceed buffer')
  const unpadded = header + len
  const next = off + unpadded + ((4 - (unpadded % 4)) % 4)
  if (next > buf.length) throw new Error('envelope: bytes padding exceeds buffer')
  return { value: Buffer.from(buf.subarray(start, start + len)), next }
}

function tlString(s: string | undefined): Buffer {
  return tlBytes(Buffer.from(s ?? '', 'utf8'))
}

function readTlString(buf: Buffer, off: number): { value: string; next: number } {
  const r = readTlBytes(buf, off)
  return { value: r.value.toString('utf8'), next: r.next }
}

function long(n: number | undefined): Buffer {
  if (!isSafeLong(n)) throw new Error('envelope: malformed long')
  const b = Buffer.alloc(8)
  b.writeBigInt64LE(BigInt(n), 0)
  return b
}

function readLong(buf: Buffer, off: number): { value: number; next: number } {
  if (off + 8 > buf.length) throw new Error('envelope: truncated long')
  const value = buf.readBigInt64LE(off)
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) throw new Error('envelope: unsafe long')
  return { value: Number(value), next: off + 8 }
}

function isSafeLong(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n)
}

function hexBuf(s: string | undefined, bytes: number, field: string): Buffer {
  if (!s || s.length !== bytes * 2 || s.toLowerCase() !== s || !/^[0-9a-f]+$/.test(s)) {
    throw new Error(`envelope: malformed ${field}`)
  }
  return Buffer.from(s, 'hex')
}

function visibleAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c <= 0x20 || c >= 0x7f) return false
  }
  return true
}

function hasProofFields(e: WireEnvelope): boolean {
  return Boolean(e.wkey || e.wsig || e.wts || e.wexp)
}

function proofWire(e: WireEnvelope): { wkey: Buffer; wsig: Buffer; wts: number; wexp: number } {
  if (!e.wkey) {
    if (hasProofFields(e)) throw new Error('envelope: malformed proof fields')
    return { wkey: ZERO_KEY, wsig: Buffer.alloc(0), wts: 0, wexp: 0 }
  }
  const wkey = hexBuf(e.wkey, 32, 'proof key')
  const wsig = hexBuf(e.wsig, 64, 'proof signature')
  if (!isSafeLong(e.wts) || e.wts <= 0 || !isSafeLong(e.wexp) || e.wexp <= 0) {
    throw new Error('envelope: malformed proof fields')
  }
  return { wkey, wsig, wts: e.wts, wexp: e.wexp }
}

function validateEnvelope(e: WireEnvelope, withSignature: boolean): void {
  if (!isSafeLong(e.ts)) throw new Error('envelope: malformed timestamp')
  if (
    byteLen(e.type) > MAX_TYPE_BYTES ||
    byteLen(e.nick) > MAX_NICK_BYTES ||
    byteLen(e.text) > MAX_TEXT_BYTES ||
    byteLen(e.room) > MAX_ROOM_BYTES ||
    byteLen(e.to) > MAX_TO_BYTES
  ) {
    throw new Error('envelope: field limit exceeded')
  }
  if (!['', 'msg', 'hello', 'dm', 'cert-req', 'cert-grant'].includes(e.type ?? '')) {
    throw new Error('envelope: bad type')
  }
  if (!e.room || !visibleAscii(e.room)) throw new Error('envelope: malformed room')
  if (e.to) hexBuf(e.to, 32, 'recipient')
  if (e.key) {
    hexBuf(e.key, 32, 'key')
  } else if (withSignature) {
    throw new Error('envelope: unsigned')
  }
  if (withSignature) {
    if (!e.sig) throw new Error('envelope: unsigned')
    hexBuf(e.sig, 64, 'signature')
  }
  proofWire(e)
}

function toSignBytes(e: WireEnvelope, pub: Buffer): Buffer {
  const proof = proofWire(e)
  return Buffer.concat([
    ENVELOPE_V4_TOSIGN_MAGIC,
    tlString(e.type),
    tlString(e.nick),
    tlString(e.text),
    long(e.ts),
    tlString(e.room),
    tlString(e.to),
    pub,
    proof.wkey,
    tlBytes(proof.wsig),
    long(proof.wts),
    long(proof.wexp),
  ])
}

export function envelopeDigest(e: WireEnvelope, pub: Buffer): Buffer {
  if (pub.length !== 32) throw new Error('envelope: malformed key')
  validateEnvelope({ ...e, key: pub.toString('hex') }, false)
  return sha256(toSignBytes(e, pub))
}

export function marshalEnvelope(e: WireEnvelope): Buffer {
  validateEnvelope(e, true)
  const pub = hexBuf(e.key, 32, 'key')
  const sig = hexBuf(e.sig, 64, 'signature')
  const proof = proofWire(e)
  return Buffer.concat([
    ENVELOPE_V4_MAGIC,
    tlString(e.type),
    tlString(e.nick),
    tlString(e.text),
    long(e.ts),
    tlString(e.room),
    tlString(e.to),
    pub,
    proof.wkey,
    tlBytes(proof.wsig),
    long(proof.wts),
    long(proof.wexp),
    tlBytes(sig),
  ])
}

export function parseEnvelope(data: Buffer): WireEnvelope {
  if (data.length < 4 || !data.subarray(0, 4).equals(ENVELOPE_V4_MAGIC)) {
    throw new Error('envelope: unsupported TL object')
  }
  let off = 4
  const type = readTlString(data, off)
  off = type.next
  const nick = readTlString(data, off)
  off = nick.next
  const text = readTlString(data, off)
  off = text.next
  const ts = readLong(data, off)
  off = ts.next
  const room = readTlString(data, off)
  off = room.next
  const to = readTlString(data, off)
  off = to.next
  if (off + 64 > data.length) throw new Error('envelope: truncated key fields')
  const key = Buffer.from(data.subarray(off, off + 32))
  off += 32
  const wkey = Buffer.from(data.subarray(off, off + 32))
  off += 32
  const wsig = readTlBytes(data, off)
  off = wsig.next
  const wts = readLong(data, off)
  off = wts.next
  const wexp = readLong(data, off)
  off = wexp.next
  const sig = readTlBytes(data, off)
  off = sig.next
  if (off !== data.length) throw new Error('envelope: trailing TL bytes')

  const e: WireEnvelope = {
    type: type.value,
    nick: nick.value,
    text: text.value,
    ts: ts.value,
    room: room.value,
    key: key.toString('hex'),
    sig: sig.value.toString('hex'),
  }
  if (to.value) e.to = to.value
  if (wsig.value.length !== 0 || wts.value !== 0 || wexp.value !== 0 || !wkey.equals(ZERO_KEY)) {
    e.wkey = wkey.toString('hex')
    e.wsig = wsig.value.toString('hex')
    e.wts = wts.value
    e.wexp = wexp.value
  }
  validateEnvelope(e, true)
  return e
}

export function signEnvelope(e: WireEnvelope, deviceSeed: Buffer): WireEnvelope {
  const kp = keyPairFromSeed(deviceSeed)
  const base = { ...e, key: kp.publicKey.toString('hex'), sig: undefined }
  const digest = envelopeDigest(base, kp.publicKey)
  const sig = sign(digest, kp.secretKey)
  return { ...base, sig: sig.toString('hex') }
}

export function verifyEnvelope(e: WireEnvelope): EnvelopeStatus {
  if (!e.key || !e.sig) return 'unsigned'
  let pub: Buffer
  let sig: Buffer
  try {
    validateEnvelope(e, true)
    pub = hexBuf(e.key, 32, 'key')
    sig = hexBuf(e.sig, 64, 'signature')
  } catch {
    return 'invalid'
  }
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
