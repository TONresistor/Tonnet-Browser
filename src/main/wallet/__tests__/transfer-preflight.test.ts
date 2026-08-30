import { Cell, internal, loadMessage } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it, vi } from 'vitest'
import { preflightTonTransfer } from '../transfer-preflight'

const walletContract = WalletContractV5R1.create({ publicKey: Buffer.alloc(32, 1), workchain: 0 })

function options(destinationBounceable = true, destinationStatus = 'active') {
  return {
    walletContract,
    destinationBounceable,
    destinationStatus,
    walletBalance: '1000',
    message: internal({ to: `0:${'22'.repeat(32)}`, value: 1n, bounce: destinationBounceable }),
    seqno: 0,
    emulateTransaction: vi.fn().mockResolvedValue({
      accepted: true,
      success: true,
      exit_code: 0,
      total_fees: '10',
      fees: { storage_fee: '1', gas_fee: '2', fwd_fee: '3', action_fee: '4' },
    }),
  }
}

describe('preflightTonTransfer', () => {
  it('emulates the exact full external BOC locally and adds a fee safety margin', async () => {
    const input = options()
    await expect(preflightTonTransfer(input)).resolves.toEqual({
      estimatedFee: '11',
      destinationStatus: 'active',
      walletBalance: '1000',
    })
    expect(input.emulateTransaction).toHaveBeenCalledWith(
      walletContract.address.toString({ bounceable: false }),
      expect.any(String)
    )
    const boc = input.emulateTransaction.mock.calls[0][1]
    expect(Buffer.from(boc, 'base64').length).toBeGreaterThan(0)
    expect(loadMessage(Cell.fromBase64(boc).beginParse()).init).toBeDefined()
  })

  it('rejects bounceable transfers to locally detected inactive recipients before emulation', async () => {
    const input = options(true, 'uninit')
    await expect(preflightTonTransfer(input)).rejects.toThrow('not an active contract')
    expect(input.emulateTransaction).not.toHaveBeenCalled()
  })

  it('fails closed when the TVM rejects the transaction', async () => {
    const input = options(false, 'uninit')
    input.emulateTransaction.mockResolvedValueOnce({
      accepted: false,
      success: false,
      exit_code: 33,
      total_fees: '0',
    })
    await expect(preflightTonTransfer(input)).rejects.toThrow('exit code 33')
  })
})
