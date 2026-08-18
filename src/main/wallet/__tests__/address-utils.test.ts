import { Address } from '@ton/core'
import { describe, expect, it } from 'vitest'
import { parseTransferTarget } from '../address-utils'

const address = Address.parseRaw(`0:${'11'.repeat(32)}`)

describe('parseTransferTarget', () => {
  it('preserves the bounce flag from user-friendly addresses', () => {
    expect(parseTransferTarget(address.toString({ bounceable: true })).bounce).toBe(true)
    expect(parseTransferTarget(address.toString({ bounceable: false })).bounce).toBe(false)
  })

  it('uses the conservative non-bounceable policy for raw addresses', () => {
    const target = parseTransferTarget(address.toRawString())
    expect(target.address.equals(address)).toBe(true)
    expect(target.bounce).toBe(false)
  })
})
