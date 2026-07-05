import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { keyPairFromSeed } from '@ton/crypto'
import { sealBroadcast, parseBroadcast, verifyBroadcast, broadcastId, deviceKeyId, isFresh } from './broadcast'

const vectorCandidates = [
  resolve(__dirname, '../../../../TONNET/tonnet-messenger/internal/broadcast/testdata/vectors.json'),
  resolve(__dirname, '../../../../tonnet-messenger/internal/broadcast/testdata/vectors.json'),
]

interface Vectors {
  seed: string
  devicePub: string
  deviceKeyId: string
  data: string
  date: number
  broadcastId: string
  signature: string
  serialized: string
  serializedWithCert: string
}

function loadVectors(): Vectors | null {
  for (const p of vectorCandidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as Vectors
    } catch {
      // try next candidate
    }
  }
  return null
}

describe('tonnet.broadcast cross-language vectors', () => {
  const v = loadVectors()
  const guarded = v ? it : it.skip

  guarded('device key id matches the Go golden vector', () => {
    const pub = Buffer.from(v!.devicePub, 'hex')
    expect(deviceKeyId(pub).toString('hex')).toBe(v!.deviceKeyId)
  })

  guarded('broadcast id matches the Go golden vector', () => {
    const pub = Buffer.from(v!.devicePub, 'hex')
    expect(broadcastId(pub, Buffer.from(v!.data, 'utf-8'), 0).toString('hex')).toBe(v!.broadcastId)
  })

  guarded('sealed broadcast is byte-identical to the Go golden vector', () => {
    const seed = Buffer.from(v!.seed, 'hex')
    const wire = sealBroadcast(seed, Buffer.from(v!.data, 'utf-8'), v!.date)
    expect(wire.toString('hex')).toBe(v!.serialized)
  })

  guarded('signature matches the Go golden vector (deterministic ed25519)', () => {
    const frame = parseBroadcast(Buffer.from(v!.serialized, 'hex'))
    expect(frame).not.toBeNull()
    expect(frame!.signature.toString('hex')).toBe(v!.signature)
  })

  guarded('parses and verifies the certified Go golden vector', () => {
    const frame = parseBroadcast(Buffer.from(v!.serializedWithCert, 'hex'))
    expect(frame).not.toBeNull()
    expect(verifyBroadcast(frame!)).toBe(true)
    expect(frame!.data.toString('utf-8')).toBe(v!.data)
    expect(frame!.src.toString('hex')).toBe(v!.devicePub)
  })
})

describe('tonnet.broadcast roundtrip', () => {
  const seed = keyPairFromSeed(Buffer.alloc(32, 7)) && Buffer.alloc(32, 7)

  it('seal -> parse -> verify roundtrips', () => {
    const wire = sealBroadcast(seed, Buffer.from('{"type":"msg"}', 'utf-8'), 1751700000)
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
})
