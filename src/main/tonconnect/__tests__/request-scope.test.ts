import { describe, expect, it } from 'vitest'
import { checkFromAndNetwork, sameAddress } from '../request-scope'

const account = `0:${'11'.repeat(32)}`

describe('request-scope', () => {
  it('accepts matching from and mainnet network', () => {
    expect(checkFromAndNetwork({ from: account, network: '-239' }, account)).toBeNull()
  })

  it('rejects a mismatched network', () => {
    expect(checkFromAndNetwork({ network: '-3' }, account)).toBe('Network mismatch')
  })

  it('rejects a from address that is not the connected account', () => {
    expect(checkFromAndNetwork({ from: `0:${'22'.repeat(32)}` }, account)).toBe('Invalid sender address')
  })

  it('compares raw and user-friendly spellings as the same address', () => {
    expect(sameAddress(account, `EQ${'A'.repeat(46)}`)).toBe(false)
    expect(sameAddress(account, account)).toBe(true)
  })
})
