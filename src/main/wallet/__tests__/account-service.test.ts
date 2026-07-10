import { Cell } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it } from 'vitest'
import { WalletAccountService } from '../account-service'

describe('WalletAccountService', () => {
  it('derives the TonConnect account and a valid state-init BoC', () => {
    const publicKey = Buffer.alloc(32, 9)
    const contract = WalletContractV5R1.create({ publicKey, workchain: 0 })
    const account = new WalletAccountService({ getPublicKey: () => publicKey, getContract: () => contract })
    const result = account.getTonConnectAccount()
    expect(result).toMatchObject({ addressRaw: contract.address.toRawString(), publicKey: publicKey.toString('hex') })
    expect(Cell.fromBase64(result?.walletStateInit ?? '').refs.length).toBeGreaterThan(0)
  })

  it('does not expose a partial account', () => {
    const account = new WalletAccountService({ getPublicKey: () => null, getContract: () => null })
    expect(account.getTonConnectAccount()).toBeNull()
  })
})
