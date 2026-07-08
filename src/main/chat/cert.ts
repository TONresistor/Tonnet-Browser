import { keyPairFromSeed, sign, signVerify } from '@ton/crypto'
import { deviceKeyId } from './broadcast'

const CERTIFICATE_MAGIC = Buffer.from([0x31, 0xd7, 0x9e, 0xe0])
const CERTIFICATE_ID_MAGIC = Buffer.from([0xb9, 0x60, 0xae, 0x8f])
const PUB_ED25519_MAGIC = Buffer.from([0xc6, 0xb4, 0x13, 0x48])

export const CERT_MAX_SIZE = 4096

export interface ParsedCertificate {
  issuer: Buffer
  expireAt: number
  maxSize: number
  signature: Buffer
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

function certificateIdBytes(overlayId: Buffer, node: Buffer, expireAt: number, maxSize: number): Buffer {
  return Buffer.concat([CERTIFICATE_ID_MAGIC, overlayId, node, u32le(expireAt), u32le(maxSize)])
}

// issueCertificate mirrors internal/room/cert.go IssueCertificate: the owner
// binds a member's device key id to this overlay for a window and size.
export function issueCertificate(
  ownerSeed: Buffer,
  overlayId: Buffer,
  memberDevicePub: Buffer,
  expireAt: number,
  maxSize = CERT_MAX_SIZE
): Buffer {
  const kp = keyPairFromSeed(ownerSeed)
  const node = deviceKeyId(memberDevicePub)
  const toSign = certificateIdBytes(overlayId, node, expireAt, maxSize)
  const sig = sign(toSign, kp.secretKey)
  return Buffer.concat([
    CERTIFICATE_MAGIC,
    PUB_ED25519_MAGIC,
    kp.publicKey,
    u32le(expireAt),
    u32le(maxSize),
    tlBytes(sig),
  ])
}

export function parseCertificate(buf: Buffer): ParsedCertificate | null {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(CERTIFICATE_MAGIC)) return null
  let off = 4
  if (off + 36 > buf.length || !buf.subarray(off, off + 4).equals(PUB_ED25519_MAGIC)) return null
  const issuer = Buffer.from(buf.subarray(off + 4, off + 36))
  off += 36
  if (off + 8 > buf.length) return null
  const expireAt = buf.readUInt32LE(off)
  const maxSize = buf.readUInt32LE(off + 4)
  off += 8
  const first = buf[off]
  if (first !== 64) return null
  const signature = Buffer.from(buf.subarray(off + 1, off + 65))
  return { issuer, expireAt, maxSize, signature }
}

// verifyCertificate mirrors internal/room/cert.go VerifyCertificate with the
// owner pinned by the room name (#o=). No slot model; issuer must be the owner.
export function verifyCertificate(
  cert: Buffer,
  memberDevicePub: Buffer,
  overlayId: Buffer,
  size: number,
  ownerPub: Buffer,
  nowSec: number
): boolean {
  const c = parseCertificate(cert)
  if (!c) return false
  if (!c.issuer.equals(ownerPub)) return false
  if (size > c.maxSize) return false
  if (nowSec > c.expireAt) return false
  const node = deviceKeyId(memberDevicePub)
  const toSign = certificateIdBytes(overlayId, node, c.expireAt, c.maxSize)
  return signVerify(toSign, c.signature, c.issuer)
}
