import { describe, it, expect } from 'vitest'
import { keyPairFromSeed } from '@ton/crypto'
import { dmSharedKey, sealDM, openDM } from '../dm'

const seedA = Buffer.alloc(32, 0xa1)
const seedB = Buffer.alloc(32, 0xb2)
const seedEve = Buffer.alloc(32, 0xee)
const pubA = keyPairFromSeed(seedA).publicKey
const pubB = keyPairFromSeed(seedB).publicKey

describe('dm crypto', () => {
  it('round-trips a message', () => {
    const msg = Buffer.from('meet at the usual place, 21:00')
    const box = sealDM(seedA, pubB, msg)
    expect(box.includes(msg)).toBe(false)
    expect(openDM(seedB, pubA, box)).toEqual(msg)
  })

  it('rejects a third party', () => {
    const box = sealDM(seedA, pubB, Buffer.from('secret'))
    expect(() => openDM(seedEve, pubA, box)).toThrow()
  })

  it('rejects reflection', () => {
    const box = sealDM(seedA, pubB, Buffer.from('did you send this?'))
    expect(() => openDM(seedA, pubB, box)).toThrow()
  })

  it('rejects tampering', () => {
    const box = sealDM(seedA, pubB, Buffer.from('balance ok'))
    box[box.length - 1] ^= 0xff
    expect(() => openDM(seedB, pubA, box)).toThrow()
  })

  it('derives a symmetric shared key', () => {
    expect(dmSharedKey(seedA, pubB)).toEqual(dmSharedKey(seedB, pubA))
  })

  it('rejects a short box', () => {
    expect(() => openDM(seedB, pubA, Buffer.alloc(10))).toThrow()
  })
})
