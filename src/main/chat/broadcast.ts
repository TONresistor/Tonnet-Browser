import { createHash } from 'node:crypto'
import { keyPairFromSeed, sign, signVerify } from '@ton/crypto'

const BROADCAST_MAGIC = Buffer.from([0x36, 0x8b, 0x84, 0xce])
const BROADCAST_ID_MAGIC = Buffer.from([0xd9, 0x63, 0x4b, 0xec])
const BROADCAST_TOSIGN_MAGIC = Buffer.from([0x13, 0x0d, 0x6c, 0x1d])
const EMPTY_CERT_MAGIC = Buffer.from([0xcf, 0xbc, 0xda, 0x32])
const CERTIFICATE_MAGIC = Buffer.from([0x31, 0xd7, 0x9e, 0xe0])
const PUB_ED25519_MAGIC = Buffer.from([0xc6, 0xb4, 0x13, 0x48])

export const MAX_BROADCAST_SIZE = 4096
export const FRESHNESS_WINDOW_SEC = 60

export interface ParsedBroadcast {
  src: Buffer
  certificate: Buffer
  flags: number
  data: Buffer
  date: number
  signature: Buffer
}

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest()
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
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

function readTlBytes(buf: Buffer, off: number): { value: Buffer; next: number } | null {
  if (off >= buf.length) return null
  const first = buf[off]
  let len: number
  let header: number
  if (first < 254) {
    len = first
    header = 1
  } else {
    if (off + 4 > buf.length) return null
    len = buf.readUIntLE(off + 1, 3)
    header = 4
  }
  const start = off + header
  if (start + len > buf.length) return null
  const unpadded = header + len
  const next = off + unpadded + ((4 - (unpadded % 4)) % 4)
  if (next > buf.length) return null
  return { value: Buffer.from(buf.subarray(start, start + len)), next }
}

export function deviceKeyId(pub: Buffer): Buffer {
  return sha256(PUB_ED25519_MAGIC, pub)
}

export function broadcastId(srcPub: Buffer, data: Buffer, flags: number): Buffer {
  return sha256(BROADCAST_ID_MAGIC, deviceKeyId(srcPub), sha256(data), u32le(flags))
}

function toSignBytes(id: Buffer, date: number): Buffer {
  return Buffer.concat([BROADCAST_TOSIGN_MAGIC, id, u32le(date)])
}

export function sealBroadcast(deviceSeed: Buffer, data: Buffer, dateSec: number, certificate?: Buffer): Buffer {
  const kp = keyPairFromSeed(deviceSeed)
  const id = broadcastId(kp.publicKey, data, 0)
  const sig = sign(toSignBytes(id, dateSec), kp.secretKey)
  const cert = certificate ?? EMPTY_CERT_MAGIC
  const out = Buffer.concat([
    BROADCAST_MAGIC,
    PUB_ED25519_MAGIC,
    kp.publicKey,
    cert,
    u32le(0),
    tlBytes(data),
    u32le(dateSec),
    tlBytes(sig),
  ])
  if (out.length > MAX_BROADCAST_SIZE) throw new Error(`broadcast too large (${out.length} bytes)`)
  return out
}

export function isBroadcastFrame(buf: Buffer): boolean {
  return buf.length >= 4 && buf.subarray(0, 4).equals(BROADCAST_MAGIC)
}

export function parseBroadcast(buf: Buffer): ParsedBroadcast | null {
  if (buf.length > MAX_BROADCAST_SIZE || !isBroadcastFrame(buf)) return null
  let off = 4

  if (off + 36 > buf.length || !buf.subarray(off, off + 4).equals(PUB_ED25519_MAGIC)) return null
  const src = Buffer.from(buf.subarray(off + 4, off + 36))
  off += 36

  if (off + 4 > buf.length) return null
  const certMagic = buf.subarray(off, off + 4)
  let certificate: Buffer
  if (certMagic.equals(EMPTY_CERT_MAGIC)) {
    certificate = Buffer.from(certMagic)
    off += 4
  } else if (certMagic.equals(CERTIFICATE_MAGIC)) {
    const certStart = off
    off += 4
    if (off + 44 > buf.length || !buf.subarray(off, off + 4).equals(PUB_ED25519_MAGIC)) return null
    off += 36 + 8
    const csig = readTlBytes(buf, off)
    if (!csig) return null
    off = csig.next
    certificate = Buffer.from(buf.subarray(certStart, off))
  } else {
    return null
  }

  if (off + 4 > buf.length) return null
  const flags = buf.readUInt32LE(off)
  off += 4

  const dataField = readTlBytes(buf, off)
  if (!dataField) return null
  off = dataField.next

  if (off + 4 > buf.length) return null
  const date = buf.readUInt32LE(off)
  off += 4

  const sigField = readTlBytes(buf, off)
  if (!sigField) return null
  off = sigField.next

  if (off !== buf.length) return null
  return { src, certificate, flags, data: dataField.value, date, signature: sigField.value }
}

export function verifyBroadcast(pb: ParsedBroadcast): boolean {
  if (pb.flags !== 0) return false
  if (pb.src.length !== 32 || pb.signature.length !== 64) return false
  const id = broadcastId(pb.src, pb.data, pb.flags)
  return signVerify(toSignBytes(id, pb.date), pb.signature, pb.src)
}

export function isFresh(dateSec: number, nowSec: number): boolean {
  return Math.abs(nowSec - dateSec) <= FRESHNESS_WINDOW_SEC
}
