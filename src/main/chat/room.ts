/**
 * Room addressing for the decentralized group chat (ton://chat).
 *
 * A "room" is just a name (e.g. "tonnet:mesh:v1"). Everything else is derived
 * from it locally so the browser can join ANY room — no hardcoded overlay id:
 *
 *   overlay id  = tl.Hash(pub.overlay{ name: room })      → overlay.join / sendMessage
 *   adnl id     = tl.Hash(pub.ed25519{ key: nodePubkey }) → adnl.connectByADNL
 *
 * The room's member nodes are discovered from the DHT (dht.findValue on the
 * overlay id, name "nodes") which returns a TL-serialized `overlay.nodes`
 * record; parseOverlayNodes() extracts the node public keys from it.
 *
 * The byte layouts below are pinned by golden vectors in room.test.ts (captured
 * from tonutils-go), so this stays byte-for-byte compatible with the anchor,
 * the mesh nodes, and the bundled bridge.
 */
import { createHash } from 'node:crypto'

// TON TL constructor tags, exactly as tl.Serialize(_, boxed=true) writes them.
const PUB_OVERLAY_MAGIC = Buffer.from([0xcb, 0x45, 0xba, 0x34]) // pub.overlay name:bytes = PublicKey
const PUB_ED25519_MAGIC = Buffer.from([0xc6, 0xb4, 0x13, 0x48]) // pub.ed25519 key:int256 = PublicKey
const OVERLAY_NODES_MAGIC = Buffer.from([0x0e, 0x29, 0x87, 0xe4]) // overlay.nodes nodes:(vector overlay.node)

const MAX_ROOM_LEN = 128

export interface OverlayNode {
  /** node ed25519 public key (32 bytes) */
  pubkey: Buffer
  /** derived ADNL id (32 bytes) — pass (base64) to adnl.connectByADNL */
  adnlId: Buffer
}

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest()
}

/** TL `bytes`: length prefix (1 byte if <254, else 0xfe + 3-byte LE) + data, zero-padded to a 4-byte boundary. */
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

/** Trim + validate a user-entered room name. Throws on empty / too long. */
export function normalizeRoom(room: string): string {
  const r = (room ?? '').trim()
  if (!r) throw new Error('room name is empty')
  if (r.length > MAX_ROOM_LEN) throw new Error(`room name too long (max ${MAX_ROOM_LEN})`)
  return r
}

/**
 * Validate an optional bootstrap node id — a base64 ADNL id (32 bytes) the user
 * can supply to join a room directly, bypassing the overlay-nodes DHT lookup
 * (which can be slow to propagate for a freshly-created room). Returns undefined
 * when blank; throws on a malformed value so the UI can surface it.
 */
export function normalizeNodeId(node?: string): string | undefined {
  const n = (node ?? '').trim()
  if (!n) return undefined
  const raw = Buffer.from(n, 'base64')
  if (raw.length !== 32) throw new Error('node id must be a 32-byte base64 ADNL id')
  return n
}

/** overlay id = tl.Hash(pub.overlay{ name: room }) — the 32-byte id for overlay.join / sendMessage. */
export function overlayIdForRoom(room: string): Buffer {
  return sha256(PUB_OVERLAY_MAGIC, tlBytes(Buffer.from(room, 'utf-8')))
}

/** Base64 overlay id — the form the bridge JSON-RPC expects. */
export function overlayIdB64ForRoom(room: string): string {
  return overlayIdForRoom(room).toString('base64')
}

/** ADNL id = tl.Hash(pub.ed25519{ key: pubkey }) from a node's 32-byte ed25519 public key. */
export function adnlIdForPubkey(pubkey: Buffer): Buffer {
  if (pubkey.length !== 32) throw new Error(`ed25519 pubkey must be 32 bytes, got ${pubkey.length}`)
  return sha256(PUB_ED25519_MAGIC, pubkey)
}

/**
 * Parse a TL-serialized `overlay.nodes` record (the value stored under the
 * overlay's DHT key, name "nodes"). Layout:
 *   [magic 0e2987e4][count u32LE] then, per node (bare in the vector):
 *     [pub.ed25519 magic][32B pubkey][32B overlay][4B version][TL-bytes signature]
 * Only ed25519 node ids are supported (the only kind overlay members use); if a
 * different key type is encountered we stop and return the nodes parsed so far,
 * since a foreign key can't be sized safely.
 */
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
    if (!data.subarray(off, off + 4).equals(PUB_ED25519_MAGIC)) break // unknown key type — can't advance safely
    off += 4
    need(off, 32)
    const pubkey = Buffer.from(data.subarray(off, off + 32))
    off += 32
    need(off, 36) // 32B overlay + 4B version
    off += 36
    off = skipTlBytes(data, off) // signature
    out.push({ pubkey, adnlId: adnlIdForPubkey(pubkey) })
  }
  return out
}

/** Advance past a TL `bytes` field, returning the offset just after its padding. */
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
