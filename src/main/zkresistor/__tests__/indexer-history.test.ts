import { describe, expect, it } from 'vitest'
import { ZkResistorTransactionsResultSchema } from '../indexer-history'

describe('ZKResistor indexer replay schema', () => {
  it('requires deterministic ZKResistor replay fields', () => {
    const hash = Buffer.alloc(32, 7).toString('base64')
    expect(
      ZkResistorTransactionsResultSchema.parse({
        transactions: [
          {
            lt: '42',
            hash,
            block_seqno: 10,
            success: true,
            out_msgs: [{ index: 0, isExternal: true, body: 'te6ccgEBAQEAAgAAAA==' }],
          },
        ],
        incomplete: false,
      })
    ).toMatchObject({ transactions: [{ lt: '42', hash }], incomplete: false })
    expect(() =>
      ZkResistorTransactionsResultSchema.parse({
        transactions: [{ lt: '042', hash, block_seqno: 10, success: true, out_msgs: [] }],
        incomplete: false,
      })
    ).toThrow()
    expect(() =>
      ZkResistorTransactionsResultSchema.parse({
        transactions: [{ lt: '42', hash: 'not-a-hash', block_seqno: 10, success: true, out_msgs: [] }],
        incomplete: false,
      })
    ).toThrow()
  })
})
