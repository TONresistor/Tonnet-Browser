import { createHash } from 'node:crypto'

const PUB_OVERLAY_MAGIC = Buffer.from([0xcb, 0x45, 0xba, 0x34])
const PUB_ED25519_MAGIC = Buffer.from([0xc6, 0xb4, 0x13, 0x48])
const OVERLAY_NODES_MAGIC = Buffer.from([0x0e, 0x29, 0x87, 0xe4])

const MAX_ROOM_LEN = 128

export interface OverlayNode {
  pubkey: Buffer
  adnlId: Buffer
}

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest()
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

export function normalizeRoom(room?: string): string {
  const r = (room ?? '').trim()
  if (!r) throw new Error('room name is empty')
  if (r.length > MAX_ROOM_LEN) throw new Error(`room name too long (max ${MAX_ROOM_LEN})`)
  return r
}

export function normalizeNodeId(node?: string): string | undefined {
  const n = (node ?? '').trim()
  if (!n) return undefined
  const raw = Buffer.from(n, 'base64')
  if (raw.length !== 32) throw new Error('node id must be a 32-byte base64 ADNL id')
  return n
}

export function overlayIdForRoom(room: string): Buffer {
  return sha256(PUB_OVERLAY_MAGIC, tlBytes(Buffer.from(room, 'utf-8')))
}

export function overlayIdB64ForRoom(room: string): string {
  return overlayIdForRoom(room).toString('base64')
}

export function adnlIdForPubkey(pubkey: Buffer): Buffer {
  if (pubkey.length !== 32) throw new Error(`ed25519 pubkey must be 32 bytes, got ${pubkey.length}`)
  return sha256(PUB_ED25519_MAGIC, pubkey)
}

export function parseOverlayNodes(data: Buffer): OverlayNode[] {
  const need = (off: number, n: number): void => {
    if (off + n > data.length) throw new Error('overlay.nodes: truncated record')
  }
  need(0, 8)
  if (!data.subarray(0, 4).equals(OVERLAY_NODES_MAGIC)) throw new Error('overlay.nodes: bad magic')
  const count = data.readUInt32LE(4)
  if (count > 4096) throw new Error(`overlay.nodes: implausible node count ${count}`)

  const out: OverlayNode[] = []
  let off = 8
  for (let i = 0; i < count; i++) {
    need(off, 4)
    if (!data.subarray(off, off + 4).equals(PUB_ED25519_MAGIC)) break
    off += 4
    need(off, 32)
    const pubkey = Buffer.from(data.subarray(off, off + 32))
    off += 32
    need(off, 36)
    off += 36
    off = skipTlBytes(data, off)
    out.push({ pubkey, adnlId: adnlIdForPubkey(pubkey) })
  }
  return out
}

function skipTlBytes(data: Buffer, off: number): number {
  if (off >= data.length) throw new Error('overlay.nodes: truncated bytes header')
  const first = data[off]
  let dataLen: number
  let header: number
  if (first < 254) {
    dataLen = first
    header = 1
  } else {
    if (off + 4 > data.length) throw new Error('overlay.nodes: truncated long-bytes header')
    dataLen = data.readUIntLE(off + 1, 3)
    header = 4
  }
  const unpadded = header + dataLen
  const next = off + unpadded + ((4 - (unpadded % 4)) % 4)
  if (next > data.length) throw new Error('overlay.nodes: bytes field exceeds record')
  return next
}
