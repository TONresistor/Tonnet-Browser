import { Address, beginCell } from '@ton/core'
import { describe, expect, it } from 'vitest'
import { parseTransactionRequest } from '../transaction-request'

const ADDRESS = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

function encoded(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ messages: [{ address: ADDRESS, amount: '1000000000' }], ...overrides })
}

describe('parseTransactionRequest', () => {
  it('accepts structured items as an alternative and refuses ambiguous requests', () => {
    const items = [{ type: 'ton', address: ADDRESS, amount: '7' }]
    expect(parseTransactionRequest(JSON.stringify({ items }), ADDRESS)).toMatchObject({ ok: true, items })
    expect(parseTransactionRequest(encoded({ items }), ADDRESS)).toMatchObject({ ok: false })
    expect(parseTransactionRequest(JSON.stringify({ items: [{ type: 'unknown' }] }), ADDRESS)).toMatchObject({
      ok: false,
    })
    expect(parseTransactionRequest(JSON.stringify({ items: Array(5).fill(items[0]) }), ADDRESS)).toMatchObject({
      ok: false,
    })
  })

  it.each(['not-a-number', '1.5', '-1', ''])('rejects invalid item integers without throwing (%s)', (amount) => {
    expect(
      parseTransactionRequest(JSON.stringify({ items: [{ type: 'ton', address: ADDRESS, amount }] }), ADDRESS)
    ).toMatchObject({ ok: false })
    expect(
      parseTransactionRequest(
        JSON.stringify({ items: [{ type: 'nft', nftAddress: ADDRESS, newOwner: ADDRESS, queryId: amount }] }),
        ADDRESS
      )
    ).toMatchObject({ ok: false })
  })

  it.each([null, [], { messages: [null] }, { messages: [{}] }, { network: 239, messages: [] }])(
    'rejects malformed payload %j',
    (payload) => {
      expect(parseTransactionRequest(JSON.stringify(payload), ADDRESS)).toMatchObject({ ok: false })
    }
  )

  it('rejects unsupported currencies, test-only item addresses and overflowing amounts', () => {
    expect(
      parseTransactionRequest(
        JSON.stringify({ messages: [{ address: ADDRESS, amount: '1', extra_currency: { 1: '1' } }] }),
        ADDRESS
      )
    ).toMatchObject({ ok: false })
    expect(
      parseTransactionRequest(
        JSON.stringify({ items: [{ type: 'ton', address: ADDRESS, amount: (1n << 120n).toString() }] }),
        ADDRESS
      )
    ).toMatchObject({ ok: false })
    expect(
      parseTransactionRequest(
        JSON.stringify({
          items: [{ type: 'ton', address: Address.parse(ADDRESS).toString({ testOnly: true }), amount: '1' }],
        }),
        ADDRESS
      )
    ).toMatchObject({ ok: false })
  })
  it('returns a normalized transaction summary for approval', () => {
    const result = parseTransactionRequest(encoded(), ADDRESS, 100)
    expect(result).toEqual({
      ok: true,
      messages: [{ address: ADDRESS, amount: '1000000000', payload: undefined, stateInit: undefined }],
      totalNano: 1_000_000_000n,
      hasContractPayload: false,
    })
  })

  it('validates network, sender, expiry and message count', () => {
    expect(parseTransactionRequest(encoded({ network: '-3' }), ADDRESS).ok).toBe(false)
    expect(parseTransactionRequest(encoded({ from: '0:' + '1'.repeat(64) }), ADDRESS)).toMatchObject({
      error: 'Invalid sender address',
    })
    expect(parseTransactionRequest(encoded({ valid_until: 99 }), ADDRESS, 100)).toMatchObject({
      error: 'Transaction expired',
    })
    expect(parseTransactionRequest(JSON.stringify({ messages: [] }), ADDRESS)).toMatchObject({ error: 'No messages' })
  })

  it('rejects non-friendly recipients and non-decimal amounts', () => {
    expect(
      parseTransactionRequest(JSON.stringify({ messages: [{ address: '0:' + '1'.repeat(64), amount: '1' }] }), ADDRESS)
    ).toMatchObject({ error: 'Address must be user-friendly' })
    expect(
      parseTransactionRequest(JSON.stringify({ messages: [{ address: ADDRESS, amount: '1.5' }] }), ADDRESS)
    ).toMatchObject({ error: 'Amount must be a string of nanocoins' })
  })

  it('runtime-validates payload and state-init BoCs', () => {
    const boc = beginCell().storeUint(1, 1).endCell().toBoc().toString('base64')
    expect(
      parseTransactionRequest(
        JSON.stringify({ messages: [{ address: ADDRESS, amount: '1', payload: boc, stateInit: boc }] }),
        ADDRESS
      )
    ).toMatchObject({ ok: true, hasContractPayload: true })
    expect(
      parseTransactionRequest(
        JSON.stringify({ messages: [{ address: ADDRESS, amount: '1', payload: 'bad' }] }),
        ADDRESS
      )
    ).toMatchObject({ error: 'Invalid payload BoC' })
  })
})
