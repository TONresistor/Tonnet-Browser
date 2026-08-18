import { Address, internal } from '@ton/core'
import { keyPairFromSeed } from '@ton/crypto'
import { describe, expect, it } from 'vitest'
import { buildExternalWalletBoc } from '../wallet-boc'
import { createWalletContract, WalletVersionSchema } from '../wallet-versions'

describe('buildExternalWalletBoc', () => {
  it.each(WalletVersionSchema.options)('builds a first transfer for %s', (version) => {
    const keypair = keyPairFromSeed(Buffer.alloc(32, 7))
    const walletContract = createWalletContract(version, keypair.publicKey)
    const result = buildExternalWalletBoc({
      walletContract,
      secretKey: keypair.secretKey,
      messages: [
        internal({
          to: Address.parseRaw(`0:${'22'.repeat(32)}`),
          value: 1n,
          bounce: false,
        }),
      ],
      seqno: 0,
      maxTimeout: 300,
      nowSeconds: 1_000,
    })
    expect(Buffer.from(result.boc, 'base64').length).toBeGreaterThan(0)
    expect(result.validUntil).toBe(0xffffffff)
    keypair.publicKey.fill(0)
    keypair.secretKey.fill(0)
  })
})
