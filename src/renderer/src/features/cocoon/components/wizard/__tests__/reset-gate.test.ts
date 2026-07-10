import { describe, it, expect } from 'vitest'
import { classifyOwnerBalance, decideReset, DUST_NANO } from '../reset-gate'

describe('classifyOwnerBalance', () => {
  it('treats a balance at or above the dust threshold as funded', () => {
    expect(classifyOwnerBalance(DUST_NANO.toString())).toBe('funded')
    expect(classifyOwnerBalance('20000000000')).toBe('funded')
  })

  it('treats a balance below the dust threshold as empty', () => {
    expect(classifyOwnerBalance('0')).toBe('empty')
    expect(classifyOwnerBalance((DUST_NANO - 1n).toString())).toBe('empty')
  })

  it('treats a non-numeric response as unverified (risky)', () => {
    expect(classifyOwnerBalance({ unexpected: true })).toBe('unverified')
  })

  it('treats a non-numeric payload as unverified (risky)', () => {
    expect(classifyOwnerBalance('not-a-number')).toBe('unverified')
    expect(classifyOwnerBalance(undefined)).toBe('unverified')
  })
})

describe('decideReset', () => {
  it('routes an empty wallet to the light confirm', () => {
    expect(decideReset('0')).toEqual({ phase: 'confirmEmpty', verifyFailed: false, balanceNano: null })
  })

  it('routes a funded wallet to the warning with its balance', () => {
    expect(decideReset('20000000000')).toEqual({
      phase: 'warnFunded',
      verifyFailed: false,
      balanceNano: '20000000000',
    })
  })

  it('routes an unverifiable balance to the warning without a balance', () => {
    expect(decideReset({ unexpected: true })).toEqual({
      phase: 'warnFunded',
      verifyFailed: true,
      balanceNano: null,
    })
  })
})
