import { describe, it, expect } from 'vitest'
import { keyPairFromSeed, sign } from '@ton/crypto'
import { verifyProof, deriveWalletAddress, proofPayload, proofDigest, PROOF_TTL_S } from './tonproof'
import type { WireEnvelope } from './envelope'

const wallet = keyPairFromSeed(Buffer.alloc(32, 11))
const wkey = wallet.publicKey.toString('hex')
const deviceKey = keyPairFromSeed(Buffer.alloc(32, 22)).publicKey.toString('hex')
const now = 2_000_000
const wts = now - 10
const wexp = wts + PROOF_TTL_S

function buildProof(): WireEnvelope {
  const address = deriveWalletAddress(wkey)!
  const wsig = sign(proofDigest(address, wts, proofPayload(deviceKey, wexp)), wallet.secretKey).toString('hex')
  return { type: 'msg', nick: '', text: '', ts: now, key: deviceKey, wkey, wsig, wts, wexp }
}

describe('chat tonproof', () => {
  it('accepts a valid wallet proof and returns the address', () => {
    const res = verifyProof(buildProof(), now)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.address.toString()).toBe(deriveWalletAddress(wkey)!.toString())
  })

  it('rejects an expired proof', () => {
    expect(verifyProof(buildProof(), wexp + 1).ok).toBe(false)
  })

  it('rejects a future timestamp', () => {
    expect(verifyProof({ ...buildProof(), wts: now + 100_000 }, now).ok).toBe(false)
  })

  it('rejects a rebound device key', () => {
    const otherDevice = keyPairFromSeed(Buffer.alloc(32, 33)).publicKey.toString('hex')
    expect(verifyProof({ ...buildProof(), key: otherDevice }, now).ok).toBe(false)
  })

  it('rejects when no proof is present', () => {
    expect(verifyProof({ type: 'msg', nick: '', text: '', ts: 1 }, now).ok).toBe(false)
  })
})
