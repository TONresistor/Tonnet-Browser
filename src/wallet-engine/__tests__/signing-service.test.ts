import { beginCell, Address } from '@ton/core'
import { keyPairFromSeed, sign, signVerify } from '@ton/crypto'
import { describe, expect, it } from 'vitest'
import { WalletSigningService } from '../signing-service'

const keys = keyPairFromSeed(Buffer.alloc(32, 7))
const address = Address.parseRaw(`0:${'11'.repeat(32)}`)

// Frozen protocol vectors: flat-message hashes independently calculated with
// Python hashlib/struct; the cell follows the TON Connect RPC cell schema
// with CRC32(value:uint32) = 3212796006. Never derive these from the SUT.
const proofDigest = Buffer.from('e17b60dea0d86ed9eb1243d891490f829a50e53cb5b4893b1123a0d67942b13d', 'hex')

function service() {
  const digests: Buffer[] = []
  return {
    digests,
    signing: new WalletSigningService({
      getAddress: () => address,
      nowSeconds: () => 1_700_000_000,
      signDigest: async (digest) => {
        digests.push(digest)
        return Buffer.from(sign(digest, keys.secretKey))
      },
    }),
  }
}

describe('WalletSigningService', () => {
  it('builds a deterministic and verifiable ton_proof reply', async () => {
    const { signing, digests } = service()
    const result = await signing.signTonProof('example.ton', 'nonce')
    expect(result).toMatchObject({
      timestamp: 1_700_000_000,
      domain: { lengthBytes: 11, value: 'example.ton' },
      payload: 'nonce',
    })
    expect(digests[0]).toEqual(proofDigest)
    expect(signVerify(proofDigest, Buffer.from(result.signature, 'base64'), keys.publicKey)).toBe(true)
  })

  it.each([
    {
      type: 'text' as const,
      text: 'Approve this message',
      expectedDigest: '5dd48746cf38862f528f1688c1fdc7db63cc1febf2eeeed1f593ed71ee6e41b4',
    },
    {
      type: 'binary' as const,
      bytes: Buffer.from('binary').toString('base64'),
      expectedDigest: '2f9143a6dd872bc88c1644e632ba18c14e324e81d53f676867802037a7e84b8c',
    },
    {
      type: 'cell' as const,
      expectedDigest: '738acd6cc4b74a2eb4213df87430531352fdd974f481c36b51f00995407b559f',
      schema: 'value:uint32',
      cell: beginCell().storeUint(7, 32).endCell().toBoc().toString('base64'),
    },
  ])('signs $type data through the injected key boundary', async ({ expectedDigest, ...payload }) => {
    const { signing, digests } = service()
    const result = await signing.signData('example.ton', payload)
    expect(result).toMatchObject({ address: address.toRawString(), timestamp: 1_700_000_000, payload })
    const reference = Buffer.from(expectedDigest, 'hex')
    expect(digests[0]).toEqual(reference)
    expect(signVerify(reference, Buffer.from(result.signature, 'base64'), keys.publicKey)).toBe(true)
  })

  it('binds ton_proof signatures to the domain and nonce', async () => {
    const { signing } = service()
    for (const [domain, nonce] of [
      ['other.ton', 'nonce'],
      ['example.ton', 'other-nonce'],
    ]) {
      const result = await signing.signTonProof(domain, nonce)
      expect(signVerify(proofDigest, Buffer.from(result.signature, 'base64'), keys.publicKey)).toBe(false)
    }
  })

  it('fails closed when no account is available', async () => {
    const signing = new WalletSigningService({
      getAddress: () => null,
      nowSeconds: () => 0,
      signDigest: async () => Buffer.alloc(64),
    })
    await expect(signing.signTonProof('example.ton', 'nonce')).rejects.toThrow('Wallet not initialized')
  })
})
