import { describe, expect, it, vi } from 'vitest'
import { createWalletContract, discoverWalletAccounts, WalletVersionSchema } from '../wallet-versions'

describe('wallet version discovery', () => {
  const tonMnemonic = [
    'sweet',
    'fall',
    'planet',
    'credit',
    'shock',
    'pottery',
    'search',
    'wreck',
    'matrix',
    'quiz',
    'stool',
    'cook',
    'domain',
    'rug',
    'sail',
    'pretty',
    'sell',
    'route',
    'daring',
    'receive',
    'loop',
    'autumn',
    'next',
    'dove',
  ]

  it('derives distinct standard wallet accounts for the same key', () => {
    const publicKey = Buffer.alloc(32, 7)
    const accounts = WalletVersionSchema.options.map((version) => createWalletContract(version, publicKey))
    expect(new Set(accounts.map((account) => account.address.toRawString())).size).toBe(4)
  })

  it('queries every supported account without converting query failures into zero balances', async () => {
    const getBalance = vi.fn(async (_address: string) => {
      if (getBalance.mock.calls.length === 2) throw new Error('unavailable')
      return '42'
    })
    const candidates = await discoverWalletAccounts(tonMnemonic, { getBalance })
    expect(candidates.map(({ version }) => version)).toEqual(WalletVersionSchema.options)
    expect(candidates).toHaveLength(4)
    expect(candidates.filter(({ balance }) => balance === null)).toHaveLength(1)
    expect(getBalance).toHaveBeenCalledTimes(4)
  })
})
