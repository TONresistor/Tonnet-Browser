import { describe, it, expect } from 'vitest'
import { keyPairFromSeed } from '@ton/crypto'
import { sealBroadcast, parseBroadcast, verifyBroadcast, broadcastId, deviceKeyId, isFresh } from './broadcast'
import { marshalEnvelope, parseEnvelope, signEnvelope, verifyEnvelope } from './envelope'

import vectors from './__tests__/fixtures/messenger-go-vectors.json'

interface Vectors {
  seed: string
  devicePub: string
  deviceKeyId: string
  dataHex: string
  date: number
  broadcastId: string
  signature: string
  serialized: string
  serializedWithCert: string
}

describe('tonnet.broadcast cross-language vectors', () => {
  const v = vectors as Vectors
  const vectorData = (): Buffer => Buffer.from(v.dataHex, 'hex')

  it('device key id matches the Go golden vector', () => {
    const pub = Buffer.from(v.devicePub, 'hex')
    expect(deviceKeyId(pub).toString('hex')).toBe(v.deviceKeyId)
  })

  it('broadcast id matches the Go golden vector', () => {
    const pub = Buffer.from(v.devicePub, 'hex')
    expect(broadcastId(pub, vectorData(), 0).toString('hex')).toBe(v.broadcastId)
  })

  it('sealed broadcast is byte-identical to the Go golden vector', () => {
    const seed = Buffer.from(v.seed, 'hex')
    const wire = sealBroadcast(seed, vectorData(), v.date)
    expect(wire.toString('hex')).toBe(v.serialized)
  })

  it('signature matches the Go golden vector (deterministic ed25519)', () => {
    const frame = parseBroadcast(Buffer.from(v.serialized, 'hex'))
    expect(frame).not.toBeNull()
    expect(frame!.signature.toString('hex')).toBe(v.signature)
  })

  it('parses and verifies the certified Go golden vector', () => {
    const frame = parseBroadcast(Buffer.from(v.serializedWithCert, 'hex'))
    expect(frame).not.toBeNull()
    expect(verifyBroadcast(frame!)).toBe(true)
    expect(frame!.data.toString('hex')).toBe(v.dataHex)
    const env = parseEnvelope(frame!.data)
    expect(env.type).toBe('msg')
    expect(env.nick).toBe('vec')
    expect(env.text).toBe('hello v4')
    expect(env.room).toBe('tonnet:vectors')
    expect(env.key).toBe(v.devicePub)
    expect(verifyEnvelope(env)).toBe('valid')
    const signed = signEnvelope(
      { type: env.type, nick: env.nick, text: env.text, ts: env.ts, room: env.room },
      Buffer.from(v.seed, 'hex')
    )
    expect(marshalEnvelope(signed).toString('hex')).toBe(v.dataHex)
    expect(frame!.src.toString('hex')).toBe(v.devicePub)
  })
})

describe('tonnet.broadcast roundtrip', () => {
  const seed = keyPairFromSeed(Buffer.alloc(32, 7)) && Buffer.alloc(32, 7)

  it('seal -> parse -> verify roundtrips', () => {
    const wire = sealBroadcast(seed, Buffer.from('payload'), 1751700000)
    const frame = parseBroadcast(wire)
    expect(frame).not.toBeNull()
    expect(verifyBroadcast(frame!)).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const wire = sealBroadcast(seed, Buffer.from('hello', 'utf-8'), 1751700000)
    const frame = parseBroadcast(wire)!
    frame.data = Buffer.from('hellp', 'utf-8')
    expect(verifyBroadcast(frame)).toBe(false)
  })

  it('rejects unknown flags', () => {
    const wire = sealBroadcast(seed, Buffer.from('x', 'utf-8'), 1751700000)
    const frame = parseBroadcast(wire)!
    frame.flags = 1
    expect(verifyBroadcast(frame)).toBe(false)
  })

  it('freshness window is +/-60s', () => {
    expect(isFresh(1000, 1060)).toBe(true)
    expect(isFresh(1000, 1061)).toBe(false)
    expect(isFresh(1000, 940)).toBe(true)
    expect(isFresh(1000, 939)).toBe(false)
  })

  it('keeps stale replayed history cryptographically verifiable when freshness is skipped', () => {
    const wire = sealBroadcast(seed, Buffer.from('history'), 1000)
    const frame = parseBroadcast(wire)

    expect(frame).not.toBeNull()
    expect(isFresh(frame!.date, 1061)).toBe(false)
    expect(verifyBroadcast(frame!)).toBe(true)
  })
})
