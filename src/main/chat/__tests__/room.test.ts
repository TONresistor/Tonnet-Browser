import { describe, it, expect } from 'vitest'
import {
  normalizeRoom,
  normalizeNodeId,
  overlayIdForRoom,
  overlayIdB64ForRoom,
  adnlIdForPubkey,
  parseOverlayNodes,
} from '../room'

// Golden vectors captured from tonutils-go v1.17.2 (tl.Hash / tl.Serialize):
//   overlay id  of room "tonnet:groupchat:v1"
//   adnl id     of node pubkey pFtc9GmL...  (== live mesh node A on the DHT)
//   overlay.nodes record carrying that one node
const ROOM = 'tonnet:groupchat:v1'
const ROOM_OVERLAY_ID_B64 = 'YNsvFzQZ4AKXJmBLLHrm4p2JmoATens+MJCXxCb8gZM='
const NODE_PUBKEY_B64 = 'pFtc9GmLbBSxByXZJP1nW8aordNLbbk9F0hxgPuXX3I='
const NODE_ADNL_ID_B64 = 'WFG59cARqwclrUm6ubboSeeDHU4jR6d3HwUcWviY5RI='

// tl.Serialize(overlay.NodesList{[node]}, boxed) for the node above (signature = 0x00..0x3f)
const NODES_1 =
  '0e2987e401000000c6b41348a45b5cf4698b6c14b10725d924fd675bc6a8add34b6db93d17487180fb975f7260db2f17' +
  '3419e0029726604b2c7ae6e29d899a80137a7b3e309097c426fc819380b41d6740000102030405060708090a0b0c0d0e' +
  '0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f000000'
const NODES_2 =
  '0e2987e402000000c6b41348a45b5cf4698b6c14b10725d924fd675bc6a8add34b6db93d17487180fb975f7260db2f17' +
  '3419e0029726604b2c7ae6e29d899a80137a7b3e309097c426fc819380b41d6740000102030405060708090a0b0c0d0e' +
  '0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f000000' +
  'c6b41348a45b5cf4698b6c14b10725d924fd675bc6a8add34b6db93d17487180fb975f7260db2f173419e0029726604b' +
  '2c7ae6e29d899a80137a7b3e309097c426fc819380b41d6740000102030405060708090a0b0c0d0e0f101112131415161718' +
  '191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f000000'

describe('overlayIdForRoom', () => {
  it('matches the tonutils-go overlay id for the reference room', () => {
    expect(overlayIdB64ForRoom(ROOM)).toBe(ROOM_OVERLAY_ID_B64)
    expect(overlayIdForRoom(ROOM)).toHaveLength(32)
  })

  it('is deterministic and room-specific', () => {
    expect(overlayIdB64ForRoom('tonnet:mesh:v1')).toBe(overlayIdB64ForRoom('tonnet:mesh:v1'))
    expect(overlayIdB64ForRoom('tonnet:mesh:v1')).not.toBe(ROOM_OVERLAY_ID_B64)
  })

  it('handles a long (>=254 byte) room name without throwing', () => {
    // exercises the 0xfe long-length branch of the TL bytes encoding
    const long = 'x'.repeat(300)
    expect(() => overlayIdForRoom(long)).not.toThrow()
    expect(overlayIdForRoom(long)).toHaveLength(32)
  })
})

describe('adnlIdForPubkey', () => {
  it('derives the ADNL id from an ed25519 public key (matches tonutils-go)', () => {
    const pub = Buffer.from(NODE_PUBKEY_B64, 'base64')
    expect(adnlIdForPubkey(pub).toString('base64')).toBe(NODE_ADNL_ID_B64)
  })

  it('rejects a wrong-sized key', () => {
    expect(() => adnlIdForPubkey(Buffer.alloc(31))).toThrow(/32 bytes/)
  })
})

describe('parseOverlayNodes', () => {
  it('extracts the node pubkey + derived adnl id from a 1-node record', () => {
    const nodes = parseOverlayNodes(Buffer.from(NODES_1, 'hex'))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].pubkey.toString('base64')).toBe(NODE_PUBKEY_B64)
    expect(nodes[0].adnlId.toString('base64')).toBe(NODE_ADNL_ID_B64)
  })

  it('walks past variable-length signatures to parse every node', () => {
    const nodes = parseOverlayNodes(Buffer.from(NODES_2, 'hex'))
    expect(nodes).toHaveLength(2)
    expect(nodes[1].pubkey.toString('base64')).toBe(NODE_PUBKEY_B64)
  })

  it('parses a real record captured live from the DHT (default-room anchor)', () => {
    // Independent vector: the actual `overlay.nodes` value the production anchor
    // publishes under overlayIdForRoom('tonnet:groupchat:v1'), fetched via dht.findValue.
    // Confirms byte-compat with what the bridge returns to the browser at runtime.
    const LIVE =
      '0e2987e401000000c6b41348c9c1927934104f914f28f4874e6aa5f5027800d7b8abcbf973ab7a0ee6a352f260db2f17' +
      '3419e0029726604b2c7ae6e29d899a80137a7b3e309097c426fc8193df9e476a4073fdda9f1aebe9669964b44a711d5d' +
      'ba1128347deb1664f78e08233b73b157a2cc80a23a47e7f7a23da19a41b465ef2d59937091e57c8b3a9f3c6c463a99da09000000'
    const nodes = parseOverlayNodes(Buffer.from(LIVE, 'hex'))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].pubkey.toString('base64')).toBe('ycGSeTQQT5FPKPSHTmql9QJ4ANe4q8v5c6t6DuajUvI=')
    // derived ADNL id must equal the known production anchor ADNL id
    expect(nodes[0].adnlId.toString('base64')).toBe('f+R0sAdNw5W1IbBNa7wO1D80n/vvT9fdugL7pPh56ZQ=')
  })

  it('rejects a record with a bad magic', () => {
    const bad = Buffer.from(NODES_1, 'hex')
    bad[0] ^= 0xff
    expect(() => parseOverlayNodes(bad)).toThrow(/bad magic/)
  })

  it('rejects a truncated record', () => {
    const trunc = Buffer.from(NODES_1, 'hex').subarray(0, 20)
    expect(() => parseOverlayNodes(trunc)).toThrow(/truncated|exceeds/)
  })
})

describe('normalizeRoom', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeRoom('  tonnet:mesh:v1 ')).toBe('tonnet:mesh:v1')
  })
  it('rejects empty / whitespace-only', () => {
    expect(() => normalizeRoom('   ')).toThrow(/empty/)
    expect(() => normalizeRoom('')).toThrow(/empty/)
  })
  it('rejects an over-long name', () => {
    expect(() => normalizeRoom('x'.repeat(200))).toThrow(/too long/)
  })
})

describe('normalizeNodeId', () => {
  it('returns undefined for blank / whitespace', () => {
    expect(normalizeNodeId('')).toBeUndefined()
    expect(normalizeNodeId('   ')).toBeUndefined()
    expect(normalizeNodeId(undefined)).toBeUndefined()
  })
  it('accepts a valid 32-byte base64 ADNL id', () => {
    expect(normalizeNodeId('  WFG59cARqwclrUm6ubboSeeDHU4jR6d3HwUcWviY5RI= ')).toBe(
      'WFG59cARqwclrUm6ubboSeeDHU4jR6d3HwUcWviY5RI='
    )
  })
  it('rejects a value that is not 32 bytes', () => {
    expect(() => normalizeNodeId('deadbeef')).toThrow(/32-byte/)
  })
})
