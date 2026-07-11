import { beginCell } from '@ton/core'
import { describe, expect, it } from 'vitest'
import { parseTransactionRequest } from '../transaction-request'

const ADDRESS = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

function encoded(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ messages: [{ address: ADDRESS, amount: '1000000000' }], ...overrides })
}

describe('parseTransactionRequest', () => {
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
