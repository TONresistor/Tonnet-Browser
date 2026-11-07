import { Address } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { TonConnectSigningWorkflow } from '../signing-workflow'
import { WalletEngineError, type TransferAuthorization } from '../../../wallet-engine'
import type { TonConnectOutMessage } from '../types'

const destination = Address.parseRaw(`0:${'22'.repeat(32)}`).toString({ bounceable: false })

function setup(approved = true) {
  const wallet = {
    getState: () => ({ isLocked: false, needsPasswordSetup: false }),
    unlock: vi.fn(),
    getTonConnectAccount: vi.fn(() => ({
      addressRaw: `0:${'11'.repeat(32)}`,
      publicKey: 'aa',
      walletStateInit: 'boc',
    })),
    signTonProof: vi.fn(),
    signTonConnectTransaction: vi.fn(
      async (
        messages: TonConnectOutMessage[],
        _address: string,
        _id?: string,
        _validUntil?: number,
        _session?: number,
        authorize?: TransferAuthorization
      ) => {
        if (
          !authorize ||
          !(await authorize({
            operationId: _id!,
            identity: { publicKey: 'aa', addressRaw: _address, revision: 1 },
            messages,
            estimatedFee: '100',
            walletBalance: '2000000000',
            validUntil: 2000000000,
          }))
        )
          throw new WalletEngineError('USER_CANCELLED', 'Transfer cancelled')
        return 'signed-boc'
      }
    ),
    signData: vi.fn(async (_domain, payload) => ({
      signature: 'signature',
      address: `0:${'11'.repeat(32)}`,
      timestamp: 1,
      domain: 'app.ton',
      payload,
    })),
  }
  const approval = {
    request: vi.fn(async (_content: { type: string; [key: string]: unknown }) => approved),
    requestUnlock: vi.fn(),
  }
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
    expect(approval.request).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '1.5 GRAM', domain: 'app.ton' }),
      undefined
    )
    expect(approval.request.mock.calls[0][0]).toMatchObject({
      rows: expect.arrayContaining([
        { label: 'Estimated fee', value: '~0.0000001 GRAM' },
        { label: 'Valid until', value: new Date(2000000000 * 1000).toISOString() },
      ]),
    })
    expect(wallet.signTonConnectTransaction).toHaveBeenCalledWith(
      expect.any(Array),
      expectedAddress,
      expect.any(String),
      undefined,
      undefined,
      expect.any(Function),
      undefined
    )
  })

  it('never signs a rejected transaction', async () => {
    const { workflow, wallet } = setup(false)
    const result = await workflow.sendTransaction('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '2',
      method: 'sendTransaction',
      params: [JSON.stringify({ messages: [{ address: destination, amount: '1' }] })],
    })
    expect(result).toMatchObject({ id: '2', error: { code: 300 } })
    expect(wallet.signTonConnectTransaction).toHaveBeenCalledOnce()
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

  it.each([
    { network: '-3' },
    { network: 239 },
    { from: `0:${'22'.repeat(32)}` },
    { from: 'invalid-address' },
    { from: 123 },
  ])('rejects incompatible signData context %j before approval', async (context) => {
    const { workflow, wallet, approval } = setup()
    const result = await workflow.signData('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '4',
      method: 'signData',
      params: [JSON.stringify({ type: 'text', text: 'ownership', ...context })],
    })
    expect(result).toMatchObject({ id: '4', error: { code: 1 } })
    expect(approval.request).not.toHaveBeenCalled()
    expect(wallet.signData).not.toHaveBeenCalled()
  })

  it.each([false, true])('accepts the connected signer in raw/friendly form (%s)', async (friendly) => {
    const { workflow, wallet } = setup()
    const expectedAddress = `0:${'11'.repeat(32)}`
    const payload = {
      type: 'text',
      text: 'ownership',
      network: '-239',
      from: friendly ? Address.parse(expectedAddress).toString() : expectedAddress,
    }
    const result = await workflow.signData('app.ton', 'App', expectedAddress, {
      id: '5',
      method: 'signData',
      params: [JSON.stringify(payload)],
    })
    expect(result).toMatchObject({ id: '5', result: { payload } })
    expect(wallet.signData).toHaveBeenCalledOnce()
  })
})
