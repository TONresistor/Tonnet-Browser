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
    encryptData: vi.fn(async () => 'encrypted-envelope'),
    decryptData: vi.fn(async () => Buffer.from('plain', 'utf8').toString('base64')),
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

  it('encrypts after approval and echoes the connected account in the payload', async () => {
    const { workflow, wallet, approval } = setup()
    const expectedAddress = `0:${'11'.repeat(32)}`
    const recipientPublicKey = 'aa'.repeat(32)
    const result = await workflow.encryptData('app.ton', 'App', expectedAddress, {
      id: '4',
      method: 'encryptData',
      params: [
        JSON.stringify({
          bytes: Buffer.from('secret', 'utf8').toString('base64'),
          recipientPublicKey,
        }),
      ],
    })

    expect(result).toEqual({
      id: '4',
      result: {
        encrypted: 'encrypted-envelope',
        payload: {
          bytes: Buffer.from('secret', 'utf8').toString('base64'),
          recipientPublicKey,
          from: expectedAddress,
        },
      },
    })
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({ title: 'Encrypt data' }))
    expect(wallet.encryptData).toHaveBeenCalledWith(expect.objectContaining({ recipientPublicKey }), expectedAddress)
  })

  it('decrypts with a third-party salt without comparing it to from', async () => {
    const { workflow, wallet, approval } = setup()
    const expectedAddress = `0:${'11'.repeat(32)}`
    const counterparty = `0:${'33'.repeat(32)}`
    const result = await workflow.decryptData('app.ton', 'App', expectedAddress, {
      id: '5',
      method: 'decryptData',
      params: [
        JSON.stringify({
          encrypted: Buffer.from('envelope').toString('base64'),
          salt: counterparty,
          from: expectedAddress,
        }),
      ],
    })

    expect(result).toEqual({
      id: '5',
      result: {
        bytes: Buffer.from('plain', 'utf8').toString('base64'),
        payload: {
          encrypted: Buffer.from('envelope').toString('base64'),
          salt: counterparty,
          from: expectedAddress,
        },
      },
    })
    expect(approval.request).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Decrypt data',
        rows: expect.arrayContaining([expect.objectContaining({ label: 'Encrypted by' })]),
      })
    )
    expect(wallet.decryptData).toHaveBeenCalledWith(expect.objectContaining({ salt: counterparty }), expectedAddress)
  })

  it('rejects decrypt when from does not match the connected account', async () => {
    const { workflow, wallet, approval } = setup()
    const result = await workflow.decryptData('app.ton', 'App', `0:${'11'.repeat(32)}`, {
      id: '6',
      method: 'decryptData',
      params: [
        JSON.stringify({
          encrypted: Buffer.alloc(64, 1).toString('base64'),
          salt: `0:${'33'.repeat(32)}`,
          from: `0:${'44'.repeat(32)}`,
        }),
      ],
    })

    expect(result).toMatchObject({ id: '6', error: { code: 1, message: 'Invalid sender address' } })
    expect(approval.request).not.toHaveBeenCalled()
    expect(wallet.decryptData).not.toHaveBeenCalled()
  })
})
