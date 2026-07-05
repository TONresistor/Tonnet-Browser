import { describe, it, expect } from 'vitest'
import { keyPairFromSeed, sign } from '@ton/crypto'
import { signEnvelope, envelopeDigest, devicePublicKeyHex, type WireEnvelope } from '../envelope'
import { proofPayload, proofDigest, deriveWalletAddress } from '../tonproof'
import { classify } from '../verify'

const ROOM = 'tonnet:groupchat'
const DEVICE = Buffer.alloc(32, 3)
const WALLET = Buffer.alloc(32, 4)
const NOW = 1751500000

function walletProof(deviceSeed: Buffer, walletSeed: Buffer, wexp: number): Partial<WireEnvelope> {
  const devicePub = devicePublicKeyHex(deviceSeed)
  const kp = keyPairFromSeed(walletSeed)
  const wkey = kp.publicKey.toString('hex')
  const address = deriveWalletAddress(wkey)!
  const wts = NOW - 100
  const digest = proofDigest(address, wts, proofPayload(devicePub, wexp))
  return { wkey, wsig: sign(digest, kp.secretKey).toString('hex'), wts, wexp }
}

describe('classify (device tier is the floor; wallet/.ton are optional bonuses)', () => {
  it('drops a forged signature', () => {
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM }, DEVICE)
    e.sig = e.sig!.slice(0, -2) + (e.sig!.endsWith('0') ? '1' : '0')
    expect(classify(e, ROOM, NOW).drop).toBe(true)
  })

  it('drops an unsigned message', () => {
    const res = classify({ type: 'msg', nick: 'alice.ton', text: 'hi', ts: NOW * 1000 }, ROOM, NOW)
    expect(res.drop).toBe(true)
  })

  it('shows a device-only message (no wallet proof) as tier device', () => {
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM }, DEVICE)
    const res = classify(e, ROOM, NOW)
    expect(res.drop).toBe(false)
    if (!res.drop) {
      expect(res.identity.tier).toBe('device')
      expect(res.identity.address).toBeUndefined()
    }
  })

  it('drops a cross-room message', () => {
    const proof = walletProof(DEVICE, WALLET, NOW + 1000)
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM, ...proof }, DEVICE)
    expect(classify(e, 'tonnet:other', NOW).drop).toBe(true)
  })

  it('shows a wallet-proofed message as tier wallet', () => {
    const proof = walletProof(DEVICE, WALLET, NOW + 1000)
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM, ...proof }, DEVICE)
    const res = classify(e, ROOM, NOW)
    expect(res.drop).toBe(false)
    if (!res.drop) {
      expect(res.identity.tier).toBe('wallet')
      expect(res.identity.address).toBe(deriveWalletAddress(proof.wkey!)!.toString({ bounceable: false }))
    }
  })

  it('degrades a proof bound to another device key to tier device', () => {
    const proof = walletProof(Buffer.alloc(32, 7), WALLET, NOW + 1000)
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM, ...proof }, DEVICE)
    const res = classify(e, ROOM, NOW)
    expect(res.drop).toBe(false)
    if (!res.drop) expect(res.identity.tier).toBe('device')
  })

  it('degrades an expired proof to tier device', () => {
    const proof = walletProof(DEVICE, WALLET, NOW - 10)
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM, ...proof }, DEVICE)
    const res = classify(e, ROOM, NOW)
    expect(res.drop).toBe(false)
    if (!res.drop) expect(res.identity.tier).toBe('device')
  })

  it('rejects a room strip (v2 to v1)', () => {
    const proof = walletProof(DEVICE, WALLET, NOW + 1000)
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM, ...proof }, DEVICE)
    expect(classify({ ...e, room: undefined }, ROOM, NOW).drop).toBe(true)
  })

  it('binds the signature to the room (a bare v2 with no proof still needs its room)', () => {
    const e = signEnvelope({ type: 'msg', nick: 'x', text: 'hi', ts: NOW * 1000, room: ROOM }, DEVICE)
    const pub = Buffer.from(e.key!, 'hex')
    expect(envelopeDigest(e, pub).equals(envelopeDigest({ ...e, room: undefined }, pub))).toBe(false)
  })
})
