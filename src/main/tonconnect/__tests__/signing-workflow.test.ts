import { Address } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { TonConnectSigningWorkflow } from '../signing-workflow'
import { WalletEngineError, type TransferAuthorization } from '../../../wallet-engine'
import type { TonConnectOutMessage } from '../types'

const destination = Address.parseRaw(`0:${'22'.repeat(32)}`).toString({ bounceable: false })

function setup(approved = true, version = 'v5R1') {
  const wallet = {
    getState: () => ({ isLocked: false, needsPasswordSetup: false, walletVersion: version }),
    unlock: vi.fn(),
    getTonConnectAccount: vi.fn(() => ({
      addressRaw: `0:${'11'.repeat(32)}`,
      publicKey: 'aa',
      walletStateInit: 'boc',
    })),
    signTonProof: vi.fn(),
    resolveTonConnectItems: vi.fn(),
    signTonConnectMessage: vi.fn(),
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
  wallet.signTonConnectMessage.mockImplementation(wallet.signTonConnectTransaction.getMockImplementation()!)
  const approval = {
    request: vi.fn(async (_content: { type: string; [key: string]: unknown }) => approved),
    requestUnlock: vi.fn(),
  }
  return { wallet, approval, workflow: new TonConnectSigningWorkflow(wallet, approval) }
}

describe('TonConnectSigningWorkflow', () => {
  it('signs a V5 message without calling sendTransaction and warns about later submission', async () => {
    const { workflow, wallet, approval } = setup()
    const response = await workflow.signMessage('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '1',
      method: 'signMessage',
      params: [JSON.stringify({ messages: [{ address: destination, amount: '12' }] })],
    })
    expect(response).toEqual({ id: '1', result: { internalBoc: 'signed-boc' } })
    expect(wallet.signTonConnectTransaction).not.toHaveBeenCalled()
    expect(approval.request).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sign message',
        warning: expect.stringContaining('may submit'),
        actions: expect.arrayContaining([{ id: 'approve', label: 'Sign', primary: true }]),
      }),
      undefined
    )
    expect(approval.request.mock.calls[0][0].rows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Estimated fee' })])
    )
  })

  it('refuses signMessage for V4 and rejected confirmations', async () => {
    const request = {
      id: '1',
      method: 'signMessage',
      params: [JSON.stringify({ messages: [{ address: destination, amount: '12' }] })],
    }
    const legacy = setup(true, 'v4R2')
    expect(await legacy.workflow.signMessage('app.ton', 'App', `0:${'11'.repeat(32)}`, request)).toMatchObject({
      error: { code: 400 },
    })
    expect(legacy.wallet.signTonConnectMessage).not.toHaveBeenCalled()
    const rejected = setup(false)
    expect(await rejected.workflow.signMessage('app.ton', 'App', `0:${'11'.repeat(32)}`, request)).toMatchObject({
      error: { code: 300 },
    })
  })

  it('resolves structured assets before approval, shows their real destination and revalidates after consent', async () => {
    const { workflow, wallet, approval } = setup()
    wallet.resolveTonConnectItems.mockResolvedValue([
      { address: destination, amount: '50000001', payload: 'built-body' },
    ])
    const item = { type: 'jetton', master: destination, destination, amount: '123' }
    const response = await workflow.sendTransaction('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '1',
      method: 'sendTransaction',
      params: [JSON.stringify({ items: [item] })],
    })
    expect(response).toMatchObject({ result: 'signed-boc' })
    expect(wallet.resolveTonConnectItems).toHaveBeenCalledTimes(2)
    expect(approval.request.mock.calls[0][0].rows).toEqual(
      expect.arrayContaining([
        { label: 'Recipient', value: destination },
        { label: 'Amount (base units)', value: '123' },
      ])
    )
  })

  it('does not sign structured assets when ownership cannot be verified', async () => {
    const { workflow, wallet, approval } = setup()
    wallet.resolveTonConnectItems.mockRejectedValue(new Error('NFT is not owned'))
    const result = await workflow.sendTransaction('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '1',
      method: 'sendTransaction',
      params: [JSON.stringify({ items: [{ type: 'nft', nftAddress: destination, newOwner: destination }] })],
    })
    expect(result).toMatchObject({ error: { code: 1 } })
    expect(approval.request).not.toHaveBeenCalled()
    expect(wallet.signTonConnectTransaction).not.toHaveBeenCalled()
  })

  it('rejects an asset that changes while the confirmation is open', async () => {
    const { workflow, wallet } = setup()
    wallet.resolveTonConnectItems
      .mockResolvedValueOnce([{ address: destination, amount: '1' }])
      .mockRejectedValueOnce(new Error('NFT is not owned by the connected account'))
    const result = await workflow.sendTransaction('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '1',
      method: 'sendTransaction',
      params: [JSON.stringify({ items: [{ type: 'nft', nftAddress: destination, newOwner: destination }] })],
    })
    expect(result).toMatchObject({ error: { code: 1 } })
  })
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
