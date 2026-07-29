import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { keyPairFromSeed, sign } from '@ton/crypto'
import {
  ENVELOPE_DOMAIN,
  marshalEnvelope,
  parseEnvelope,
  signEnvelope,
  verifyEnvelope,
  devicePublicKeyHex,
  type WireEnvelope,
} from '../envelope'
import {
  TONPROOF_DOMAIN,
  proofPayload,
  proofDigest,
  deriveWalletAddress,
  verifyProof,
  friendlyAddress,
  shortAddress,
} from '../tonproof'
import { dmSharedKey, sealDM, openDM } from '../dm'
import fixture from './vectors.json'

const DEVICE_SEED = Buffer.alloc(32, 1)
const WALLET_SEED = Buffer.alloc(32, 9)
const PEER_SEED = Buffer.alloc(32, 2)
const DM_NONCE = Buffer.alloc(12, 0x0b)
const DM_PLAINTEXT = 'dm interop vector'
const WTS = 1719900000
const WEXP = 1720504800
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

  const peerPub = keyPairFromSeed(PEER_SEED).publicKey
  const dmBox = sealDM(DEVICE_SEED, peerPub, Buffer.from(DM_PLAINTEXT, 'utf8'), DM_NONCE)

  return {
    deviceSeed: DEVICE_SEED.toString('hex'),
    walletSeed: WALLET_SEED.toString('hex'),
    devicePub,
    walletPub,
    walletAddressRaw: address.toRawString(),
    walletAddressFriendly: friendlyAddress(address),
    walletAddressShort: shortAddress(address),
    tonproofDomain: TONPROOF_DOMAIN,
    wts: WTS,
    wexp: WEXP,
    proofPayload: payload,
    proofDigest: digest.toString('hex'),
    wsig,
    envelopeDomain: ENVELOPE_DOMAIN,
    dmPeerSeed: PEER_SEED.toString('hex'),
    dmPeerPub: peerPub.toString('hex'),
    dmSharedKey: dmSharedKey(DEVICE_SEED, peerPub).toString('hex'),
    dmPlaintext: DM_PLAINTEXT,
    dmBox: dmBox.toString('base64'),
  }
}

function proofFields(): Required<Pick<WireEnvelope, 'wkey' | 'wsig' | 'wts' | 'wexp'>> {
  return {
    wkey: fixture.walletPub as string,
    wsig: fixture.wsig as string,
    wts: fixture.wts as number,
    wexp: fixture.wexp as number,
  }
}

function v4NoProof(): WireEnvelope {
  return signEnvelope({ type: 'msg', nick: 'alice', text: 'hi', ts: 1719900000000, room: ROOM }, DEVICE_SEED)
}

function v4Proof(): WireEnvelope {
  return signEnvelope(
    {
      type: 'msg',
      nick: fixture.walletAddressShort as string,
      text: 'hi',
      ts: WTS * 1000,
      room: ROOM,
      ...proofFields(),
    },
    DEVICE_SEED
  )
}

function v4Dm(): WireEnvelope {
  return signEnvelope(
    {
      type: 'dm',
      nick: fixture.walletAddressShort as string,
      text: fixture.dmBox as string,
      ts: WTS * 1000,
      room: ROOM,
      to: fixture.dmPeerPub as string,
      ...proofFields(),
    },
    DEVICE_SEED
  )
}

describe('cross-language chat identity vectors', () => {
  const computed = buildVectors()

  if (process.env.GEN_CHAT_VECTORS === '1') {
    writeFileSync(join(__dirname, 'vectors.json'), JSON.stringify(computed, null, 2) + '\n')
  }

  it('matches the frozen fixture byte for byte', () => {
    expect(computed).toEqual(fixture)
  })

  it('uses the v4 envelope domain from the Go protocol vector', () => {
    expect(ENVELOPE_DOMAIN).toBe(fixture.envelopeDomain)
  })

  it('verifies signed v4 envelopes and roundtrips their TL bytes', () => {
    for (const env of [v4NoProof(), v4Proof(), v4Dm()]) {
      expect(verifyEnvelope(env)).toBe('valid')
      const wire = marshalEnvelope(env)
      const parsed = parseEnvelope(wire)
      expect(parsed).toEqual(env)
      expect(marshalEnvelope(parsed).toString('hex')).toBe(wire.toString('hex'))
      expect(verifyEnvelope(parsed)).toBe('valid')
    }
  })

  it('requires recipients only for dm and cert-grant envelopes', () => {
    expect(() =>
      signEnvelope(
        { type: 'msg', nick: '', text: 'x', ts: WTS * 1000, room: ROOM, to: fixture.dmPeerPub as string },
        DEVICE_SEED
      )
    ).toThrow('unexpected recipient')
    expect(() => signEnvelope({ type: 'dm', nick: '', text: 'x', ts: WTS * 1000, room: ROOM }, DEVICE_SEED)).toThrow(
      'malformed recipient'
    )
  })

  it('opens the fixture dm box and rejects redirect', () => {
    const env = v4Dm()
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
    const proofed = v4Proof()
    const res = verifyProof(proofed, now)
    expect(res.ok).toBe(true)
    if (res.ok) expect(friendlyAddress(res.address)).toBe(fixture.walletAddressFriendly)

    const stolen = { ...proofed, key: devicePublicKeyHex(Buffer.alloc(32, 2)) }
    expect(verifyEnvelope(stolen)).toBe('invalid')

    const expired = verifyProof(proofed, (fixture.wexp as number) + 1)
    expect(expired.ok).toBe(false)
    expect(verifyProof({ ...proofed, wexp: WTS + 7 * 24 * 3600 + 1 }, now)).toMatchObject({
      ok: false,
      reason: 'bad-proof',
    })

    const grafted = { ...v4NoProof(), ...proofFields() }
    expect(verifyEnvelope(grafted)).toBe('invalid')

    const transferred = signEnvelope(
      {
        type: 'msg',
        nick: 'x',
        text: 'hi',
        ts: 1719900000000,
        room: ROOM,
        ...proofFields(),
      },
      Buffer.alloc(32, 2)
    )
    expect(verifyEnvelope(transferred)).toBe('valid')
    expect(verifyProof(transferred, now).ok).toBe(false)

    const crossRoom = { ...proofed, room: 'tonnet:other' }
    expect(verifyEnvelope(crossRoom)).toBe('invalid')
  })
})
