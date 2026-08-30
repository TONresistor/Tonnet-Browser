import { describe, expect, it } from 'vitest'
import { toCocoonFundingAddress } from '../funding-address'

describe('toCocoonFundingAddress', () => {
  it('converts the generated owner wallet to the non-bounceable funding form', () => {
    expect(toCocoonFundingAddress('EQBbqVdevDpe4HpHngIdGbs8dsD0CYqEIxNKbrPbEbGhlByR')).toBe(
      'UQBbqVdevDpe4HpHngIdGbs8dsD0CYqEIxNKbrPbEbGhlEFU'
    )
  })

  it('keeps an existing non-bounceable owner address stable', () => {
    const address = 'UQBbqVdevDpe4HpHngIdGbs8dsD0CYqEIxNKbrPbEbGhlEFU'
    expect(toCocoonFundingAddress(address)).toBe(address)
  })
})
