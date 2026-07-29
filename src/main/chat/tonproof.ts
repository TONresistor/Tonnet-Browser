import { createHash } from 'node:crypto'
import { signVerify } from '@ton/crypto'
import { Address } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import type { WireEnvelope } from './envelope'

export const TONPROOF_DOMAIN = 'tonnet.chat'
export const PROOF_TTL_S = 7 * 24 * 3600
const MAX_SKEW_S = 300
const ADDR_CACHE_MAX = 4096
const HEX32 = /^[0-9a-f]{64}$/
const HEX64 = /^[0-9a-f]{128}$/

const addrCache = new Map<string, Address>()

export type ProofResult =
  | { ok: true; address: Address }
  | { ok: false; reason: 'no-proof' | 'bad-proof' | 'future' | 'expired' | 'bad-wallet' }

export function proofPayload(deviceKeyHex: string, wexp: number): string {
  return `tonnet-chat-device:v1:${deviceKeyHex}:${wexp}`
}

export function deriveWalletAddress(wkeyHex: string): Address | null {
  const cached = addrCache.get(wkeyHex)
  if (cached) return cached
  if (!HEX32.test(wkeyHex)) return null
  const address = WalletContractV5R1.create({ publicKey: Buffer.from(wkeyHex, 'hex'), workchain: 0 }).address
  if (addrCache.size >= ADDR_CACHE_MAX) {
    const first = addrCache.keys().next().value
    if (first !== undefined) addrCache.delete(first)
  }
  addrCache.set(wkeyHex, address)
  return address
}

export function proofDigest(address: Address, wts: number, payload: string): Buffer {
  const wc = Buffer.alloc(4)
  wc.writeInt32BE(address.workChain, 0)
  const domainBuf = Buffer.from(TONPROOF_DOMAIN, 'utf8')
  const domainLen = Buffer.alloc(4)
  domainLen.writeUInt32LE(domainBuf.byteLength, 0)
  const ts = Buffer.alloc(8)
  ts.writeBigUInt64LE(BigInt(wts), 0)
  const message = Buffer.concat([
    Buffer.from('ton-proof-item-v2/', 'utf8'),
    wc,
    address.hash,
    domainLen,
    domainBuf,
    ts,
    Buffer.from(payload, 'utf8'),
  ])
  const inner = createHash('sha256').update(message).digest()
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from('ton-connect', 'utf8'), inner]))
    .digest()
}

export function verifyProof(e: WireEnvelope, nowSec: number): ProofResult {
  if (!e.wkey) return { ok: false, reason: 'no-proof' }
  if (
    !HEX32.test(e.wkey) ||
    !e.wsig ||
    !HEX64.test(e.wsig) ||
    !e.wts ||
    e.wts <= 0 ||
    !e.wexp ||
    e.wexp <= 0 ||
    !e.key
  ) {
    return { ok: false, reason: 'bad-proof' }
  }
  if (e.wts > nowSec + MAX_SKEW_S) return { ok: false, reason: 'future' }
  if (e.wexp <= e.wts || e.wexp - e.wts > PROOF_TTL_S) return { ok: false, reason: 'bad-proof' }
  if (e.wexp <= nowSec) return { ok: false, reason: 'expired' }
  const address = deriveWalletAddress(e.wkey)
  if (!address) return { ok: false, reason: 'bad-proof' }
  const digest = proofDigest(address, e.wts, proofPayload(e.key, e.wexp))
  const valid = signVerify(digest, Buffer.from(e.wsig, 'hex'), Buffer.from(e.wkey, 'hex'))
  return valid ? { ok: true, address } : { ok: false, reason: 'bad-wallet' }
}

export function friendlyAddress(address: Address): string {
  return address.toString({ bounceable: false })
}

export function shortAddress(address: Address): string {
  const s = friendlyAddress(address)
  return s.length <= 11 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`
}
