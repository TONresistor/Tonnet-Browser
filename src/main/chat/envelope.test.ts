import { describe, it, expect } from 'vitest'
import { keyPairFromSeed } from '@ton/crypto'
import {
  marshalEnvelope,
  parseEnvelope,
  signEnvelope,
  verifyEnvelope,
  envelopeDigest,
  fingerprint,
  devicePublicKeyHex,
  type WireEnvelope,
} from './envelope'

const seed = Buffer.alloc(32, 7)

describe('chat envelope', () => {
  it('signs and verifies a room-bound envelope', () => {
    const signed = signEnvelope({ type: 'msg', nick: 'a', text: 'hello', ts: 1000, room: 'tonnet:x' }, seed)
    expect(signed.key).toBe(devicePublicKeyHex(seed))
    expect(fingerprint(signed)).toBe(signed.key!.slice(0, 8))
    expect(verifyEnvelope(signed)).toBe('valid')
  })

  it('reports unsigned when key or sig is missing', () => {
    expect(verifyEnvelope({ type: 'msg', nick: 'a', text: 'hi', ts: 1, room: 'r' })).toBe('unsigned')
  })

  it('rejects tampered text', () => {
    const signed = signEnvelope({ type: 'msg', nick: 'a', text: 'hello', ts: 1000, room: 'r' }, seed)
    expect(verifyEnvelope({ ...signed, text: 'HELLO' })).toBe('invalid')
  })

  it('rejects a room downgrade (stripping room breaks the signature)', () => {
    const signed = signEnvelope({ type: 'msg', nick: 'a', text: 'x', ts: 1, room: 'r' }, seed)
    expect(verifyEnvelope({ ...signed, room: undefined })).toBe('invalid')
  })

  it('binds the signature to the public key', () => {
    const signed = signEnvelope({ type: 'msg', nick: 'a', text: 'x', ts: 1, room: 'r' }, seed)
    const other = keyPairFromSeed(Buffer.alloc(32, 9)).publicKey.toString('hex')
    expect(verifyEnvelope({ ...signed, key: other })).toBe('invalid')
  })

  it('domain-separates a dm from a room message', () => {
    const pub = keyPairFromSeed(seed).publicKey
    const peer = keyPairFromSeed(Buffer.alloc(32, 8)).publicKey.toString('hex')
    const msg = envelopeDigest({ type: 'msg', nick: 'a', text: 'x', ts: 1, room: 'r' }, pub)
    const dm = envelopeDigest({ type: 'dm', nick: 'a', text: 'x', ts: 1, room: 'r', to: peer }, pub)
    expect(msg.equals(dm)).toBe(false)
  })

  it('requires a room binding before signing', () => {
    expect(() => signEnvelope({ type: 'msg', nick: 'a', text: 'x', ts: 1 }, seed)).toThrow()
  })

  it('rejects non-integer timestamps instead of truncating them', () => {
    expect(() => signEnvelope({ type: 'msg', nick: 'a', text: 'x', ts: 1.5, room: 'r' }, seed)).toThrow()
  })

  it('roundtrips the TL envelope wire format', () => {
    const signed = signEnvelope({ type: 'msg', nick: 'a', text: 'hello', ts: 1000, room: 'tonnet:x' }, seed)
    const wire = marshalEnvelope(signed)
    expect(wire.subarray(0, 4).toString('hex')).toBe('c81885c4')
    const parsed = parseEnvelope(wire)
    expect(parsed).toEqual(signed)
    expect(verifyEnvelope(parsed)).toBe('valid')
  })

  it('rejects JSON envelope bytes', () => {
    const signed = signEnvelope({ type: 'msg', nick: 'a', text: 'hello', ts: 1000, room: 'tonnet:x' }, seed)
    expect(() => parseEnvelope(Buffer.from(JSON.stringify(signed), 'utf8'))).toThrow()
  })

  it('throws on incomplete proof fields', () => {
    const pub = keyPairFromSeed(seed).publicKey
    expect(() =>
      envelopeDigest({ type: 'msg', nick: 'a', text: 'x', ts: 1, room: 'r', wkey: 'aa' } as WireEnvelope, pub)
    ).toThrow()
  })
})
