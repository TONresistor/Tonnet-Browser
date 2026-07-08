import { describe, it, expect } from 'vitest'
import { keyPairFromSeed } from '@ton/crypto'
import { sealDM, openDM, dmSharedKey } from './dm'

const aliceSeed = Buffer.alloc(32, 1)
const bobSeed = Buffer.alloc(32, 2)
const alicePub = keyPairFromSeed(aliceSeed).publicKey
const bobPub = keyPairFromSeed(bobSeed).publicKey

describe('chat dm', () => {
  it('round-trips a message from alice to bob', () => {
    const box = sealDM(aliceSeed, bobPub, Buffer.from('hi bob'))
    expect(openDM(bobSeed, alicePub, box).toString()).toBe('hi bob')
  })

  it('derives an identical shared key in both directions', () => {
    expect(dmSharedKey(aliceSeed, bobPub).equals(dmSharedKey(bobSeed, alicePub))).toBe(true)
  })

  it('fails to open with the wrong peer key', () => {
    const box = sealDM(aliceSeed, bobPub, Buffer.from('secret'))
    const evePub = keyPairFromSeed(Buffer.alloc(32, 3)).publicKey
    expect(() => openDM(bobSeed, evePub, box)).toThrow()
  })

  it('rejects a tampered ciphertext', () => {
    const box = sealDM(aliceSeed, bobPub, Buffer.from('secret'))
    box[box.length - 1] ^= 0xff
    expect(() => openDM(bobSeed, alicePub, box)).toThrow()
  })

  it('is direction-bound: the sender cannot open their own box as if received', () => {
    const box = sealDM(aliceSeed, bobPub, Buffer.from('x'))
    expect(() => openDM(aliceSeed, bobPub, box)).toThrow()
  })

  it('rejects a too-short ciphertext', () => {
    expect(() => openDM(bobSeed, alicePub, Buffer.alloc(10))).toThrow()
  })
})
