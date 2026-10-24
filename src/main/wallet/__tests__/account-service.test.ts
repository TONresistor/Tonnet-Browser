import { Cell, contractAddress, loadStateInit } from '@ton/core'
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
    const stateInit = loadStateInit(Cell.fromBase64(result?.walletStateInit ?? '').beginParse())
    expect(stateInit.code?.equals(contract.init.code)).toBe(true)
    expect(stateInit.data?.equals(contract.init.data)).toBe(true)
    expect(contractAddress(0, stateInit).equals(contract.address)).toBe(true)
  })

  it('does not expose a partial account', () => {
    const publicKey = Buffer.alloc(32, 9)
    const contract = WalletContractV5R1.create({ publicKey, workchain: 0 })
    for (const [key, wallet] of [
      [null, null],
      [publicKey, null],
      [null, contract],
    ] as const) {
      const account = new WalletAccountService({ getPublicKey: () => key, getContract: () => wallet })
      expect(account.getTonConnectAccount()).toBeNull()
    }
  })
})
