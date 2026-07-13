import { Address } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { TonConnectSigningWorkflow } from '../signing-workflow'

const destination = Address.parseRaw(`0:${'22'.repeat(32)}`).toString({ bounceable: false })

function setup(approved = true) {
  const wallet = {
    getTonConnectAccount: vi.fn(() => ({
      addressRaw: `0:${'11'.repeat(32)}`,
      publicKey: 'aa',
      walletStateInit: 'boc',
    })),
    signTonProof: vi.fn(),
    signTonConnectTransaction: vi.fn(async () => 'signed-boc'),
    signData: vi.fn(async (_domain, payload) => ({
      signature: 'signature',
      address: `0:${'11'.repeat(32)}`,
      timestamp: 1,
      domain: 'app.ton',
      payload,
    })),
  }
  const approval = { request: vi.fn(async () => approved) }
  return { wallet, approval, workflow: new TonConnectSigningWorkflow(wallet, approval) }
}

describe('TonConnectSigningWorkflow', () => {
  it('validates, presents and signs a transaction only after approval', async () => {
    const { workflow, wallet, approval } = setup()
    const expectedAddress = `0:${'11'.repeat(32)}`
    const result = await workflow.sendTransaction('app.ton', 'App', expectedAddress, {
      id: '1',
      method: 'sendTransaction',
      params: [JSON.stringify({ messages: [{ address: destination, amount: '1500000000' }] })],
    })
    expect(result).toEqual({ id: '1', result: 'signed-boc' })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({ amount: '1.5 GRAM', domain: 'app.ton' }))
    expect(wallet.signTonConnectTransaction).toHaveBeenCalledWith(expect.any(Array), expectedAddress)
  })

  it('never signs a rejected transaction', async () => {
    const { workflow, wallet } = setup(false)
    const result = await workflow.sendTransaction('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '2',
      method: 'sendTransaction',
      params: [JSON.stringify({ messages: [{ address: destination, amount: '1' }] })],
    })
    expect(result).toMatchObject({ id: '2', error: { code: 300 } })
    expect(wallet.signTonConnectTransaction).not.toHaveBeenCalled()
  })

  it('rejects malformed signData before approval or signing', async () => {
    const { workflow, wallet, approval } = setup()
    const result = await workflow.signData('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '3',
      method: 'signData',
      params: ['{}'],
    })
    expect(result).toMatchObject({ id: '3', error: { code: 1 } })
    expect(approval.request).not.toHaveBeenCalled()
    expect(wallet.signData).not.toHaveBeenCalled()
  })
})
