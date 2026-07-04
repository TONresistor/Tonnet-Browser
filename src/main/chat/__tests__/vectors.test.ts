import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { keyPairFromSeed, sign } from '@ton/crypto'
import { signEnvelope, verifyEnvelope, devicePublicKeyHex, type WireEnvelope } from '../envelope'
import { proofPayload, proofDigest, deriveWalletAddress, verifyProof, friendlyAddress, shortAddress } from '../tonproof'
import { dmSharedKey, sealDM, openDM } from '../dm'
import fixture from './vectors.json'

const DEVICE_SEED = Buffer.alloc(32, 1)
const WALLET_SEED = Buffer.alloc(32, 9)
const PEER_SEED = Buffer.alloc(32, 2)
const DM_NONCE = Buffer.alloc(12, 0x0b)
const DM_PLAINTEXT = 'dm interop vector'
const WTS = 1719900000
const WEXP = 1722492000
const ROOM = 'tonnet:groupchat'

function buildVectors(): Record<string, unknown> {
  const devicePub = devicePublicKeyHex(DEVICE_SEED)
  const walletKp = keyPairFromSeed(WALLET_SEED)
  const walletPub = walletKp.publicKey.toString('hex')
  const address = deriveWalletAddress(walletPub)
  if (!address) throw new Error('address derivation failed')

  const payload = proofPayload(devicePub, WEXP)
  const digest = proofDigest(address, WTS, payload)
  const wsig = sign(digest, walletKp.secretKey).toString('hex')

  const v1 = signEnvelope({ type: 'msg', nick: 'alice', text: 'hi', ts: 1719900000000 }, DEVICE_SEED)
  const v2NoProof = signEnvelope({ type: 'msg', nick: 'alice', text: 'hi', ts: 1719900000000, room: ROOM }, DEVICE_SEED)
  const v2Proof = signEnvelope(
    {
      type: 'msg',
      nick: shortAddress(address),
      text: 'hi',
      ts: WTS * 1000,
      room: ROOM,
      wkey: walletPub,
      wsig,
      wts: WTS,
      wexp: WEXP,
    },
    DEVICE_SEED
  )

  const peerPub = keyPairFromSeed(PEER_SEED).publicKey
  const dmBox = sealDM(DEVICE_SEED, peerPub, Buffer.from(DM_PLAINTEXT, 'utf8'), DM_NONCE)
  const v3Dm = signEnvelope(
    {
      type: 'dm',
      nick: shortAddress(address),
      text: dmBox.toString('base64'),
      ts: WTS * 1000,
      room: ROOM,
      to: peerPub.toString('hex'),
      wkey: walletPub,
      wsig,
      wts: WTS,
      wexp: WEXP,
    },
    DEVICE_SEED
  )

  return {
    deviceSeed: DEVICE_SEED.toString('hex'),
    walletSeed: WALLET_SEED.toString('hex'),
    devicePub,
    walletPub,
    walletAddressRaw: address.toRawString(),
    walletAddressFriendly: friendlyAddress(address),
    walletAddressShort: shortAddress(address),
    tonproofDomain: 'tonnet.chat',
    wts: WTS,
    wexp: WEXP,
    proofPayload: payload,
    proofDigest: digest.toString('hex'),
    wsig,
    v1,
    v2NoProof,
    v2Proof,
    dmPeerSeed: PEER_SEED.toString('hex'),
    dmPeerPub: peerPub.toString('hex'),
    dmSharedKey: dmSharedKey(DEVICE_SEED, peerPub).toString('hex'),
    dmPlaintext: DM_PLAINTEXT,
    dmBox: dmBox.toString('base64'),
    v3Dm,
  }
}

describe('cross-language chat identity vectors', () => {
  const computed = buildVectors()

  if (process.env.GEN_CHAT_VECTORS === '1') {
    writeFileSync(join(__dirname, 'vectors.json'), JSON.stringify(computed, null, 2) + '\n')
  }

  it('matches the frozen fixture byte for byte', () => {
    expect(computed).toEqual(fixture)
  })

  it('verifies every fixture envelope', () => {
    expect(verifyEnvelope(fixture.v1 as WireEnvelope)).toBe('valid')
    expect(verifyEnvelope(fixture.v2NoProof as WireEnvelope)).toBe('valid')
    expect(verifyEnvelope(fixture.v2Proof as WireEnvelope)).toBe('valid')
    expect(verifyEnvelope(fixture.v3Dm as WireEnvelope)).toBe('valid')
  })

  it('opens the fixture dm box and rejects redirect', () => {
    const env = fixture.v3Dm as WireEnvelope
    const opened = openDM(
      Buffer.from(fixture.dmPeerSeed as string, 'hex'),
      Buffer.from(fixture.devicePub as string, 'hex'),
      Buffer.from(env.text, 'base64')
    )
    expect(opened.toString('utf8')).toBe(fixture.dmPlaintext)

    const redirected = { ...env, to: devicePublicKeyHex(Buffer.alloc(32, 3)) }
    expect(verifyEnvelope(redirected)).toBe('invalid')
  })

  it('accepts the fixture proof and rejects tampering', () => {
    const now = WTS + 100
    const res = verifyProof(fixture.v2Proof as WireEnvelope, now)
    expect(res.ok).toBe(true)
    if (res.ok) expect(friendlyAddress(res.address)).toBe(fixture.walletAddressFriendly)

    const stolen = { ...(fixture.v2Proof as WireEnvelope), key: devicePublicKeyHex(Buffer.alloc(32, 2)) }
    expect(verifyEnvelope(stolen)).toBe('invalid')

    const expired = verifyProof(fixture.v2Proof as WireEnvelope, fixture.wexp + 1)
    expect(expired.ok).toBe(false)

    const grafted = {
      ...(fixture.v2NoProof as WireEnvelope),
      wkey: fixture.walletPub,
      wsig: fixture.wsig,
      wts: fixture.wts,
      wexp: fixture.wexp,
    }
    expect(verifyEnvelope(grafted)).toBe('invalid')

    const crossRoom = { ...(fixture.v2Proof as WireEnvelope), room: 'tonnet:other' }
    expect(verifyEnvelope(crossRoom)).toBe('invalid')
  })
})
