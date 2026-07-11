import { beginCell, Address } from '@ton/core'
import { keyPairFromSeed, sign, signVerify } from '@ton/crypto'
import { describe, expect, it } from 'vitest'
import { WalletSigningService } from '../signing-service'

const keys = keyPairFromSeed(Buffer.alloc(32, 7))
const address = Address.parseRaw(`0:${'11'.repeat(32)}`)

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
    expect(signVerify(digests[0], Buffer.from(result.signature, 'base64'), keys.publicKey)).toBe(true)
  })

  it.each([
    { type: 'text' as const, text: 'Approve this message' },
    { type: 'binary' as const, bytes: Buffer.from('binary').toString('base64') },
    {
      type: 'cell' as const,
      schema: 'value:uint32',
      cell: beginCell().storeUint(7, 32).endCell().toBoc().toString('base64'),
    },
  ])('signs $type data through the injected key boundary', async (payload) => {
    const { signing, digests } = service()
    const result = await signing.signData('example.ton', payload)
    expect(result).toMatchObject({ address: address.toRawString(), timestamp: 1_700_000_000, payload })
    expect(signVerify(digests[0], Buffer.from(result.signature, 'base64'), keys.publicKey)).toBe(true)
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
