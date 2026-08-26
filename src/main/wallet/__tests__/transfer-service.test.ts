import { Address, beginCell, type MessageRelaxed } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { WalletContractV5R1 } from '@ton/ton'
import { WalletTransferService } from '../transfer-service'

const recipient = Address.parseRaw(`0:${'33'.repeat(32)}`).toString({ bounceable: false })

function setup(sendAndWatch: () => Promise<string> = async () => 'hash') {
  const bridge = { sendAndWatch: vi.fn(sendAndWatch), broadcast: vi.fn(async () => {}) }
  const context = {
    getBridge: () => bridge,
    getAccountInformation: vi.fn(),
    emulateTransaction: vi.fn(),
    runMethod: vi.fn(),
    buildBoc: vi.fn(async (_messages: MessageRelaxed[], _maxTimeout: number) => ({
      boc: beginCell().storeUint(1, 1).endCell().toBoc().toString('base64'),
    })),
    withPreflightState: vi.fn(),
    withSigningState: vi.fn(),
    notifyStateChanged: vi.fn(),
  }
  return { bridge, context, service: new WalletTransferService(context) }
}

describe('WalletTransferService', () => {
  it('binds a direct transfer to the approved wallet identity', async () => {
    const { service, bridge, context } = setup()
    const identity = { publicKey: 'aa'.repeat(32), addressRaw: `0:${'11'.repeat(32)}`, revision: 1 }

    await expect(service.send(recipient, '42', 'memo', identity)).resolves.toMatchObject({
      type: 'send',
      amount: '42',
      address: recipient,
      status: 'confirmed',
      hash: 'hash',
      comment: 'memo',
    })

    expect(context.buildBoc).toHaveBeenCalledWith(expect.any(Array), 300, undefined, identity)
    expect(bridge.sendAndWatch).toHaveBeenCalledOnce()
  })

  it('signs the prepared encrypted body and marks the local transaction', async () => {
    const { service, context } = setup()
    const identity = { publicKey: 'aa'.repeat(32), addressRaw: `0:${'11'.repeat(32)}`, revision: 1 }
    const encryptedBody = beginCell().storeUint(0x2167da4b, 32).endCell()

    await expect(service.send(recipient, '42', 'private memo', identity, encryptedBody, true)).resolves.toMatchObject({
      comment: 'private memo',
      commentEncrypted: true,
    })

    const message = context.buildBoc.mock.calls[0]![0][0]
    expect(message.body?.equals(encryptedBody)).toBe(true)
  })

  it('builds and watches a TonConnect transaction', async () => {
    const { service, bridge, context } = setup()
    const expectedAddress = `0:${'11'.repeat(32)}`
    const boc = await service.signTonConnectTransaction([{ address: recipient, amount: '42' }], expectedAddress)
    expect(Buffer.from(boc, 'base64').length).toBeGreaterThan(0)
    expect(context.buildBoc).toHaveBeenCalledWith(expect.any(Array), 300, expectedAddress)
    expect(bridge.sendAndWatch).toHaveBeenCalledOnce()
    expect(bridge.broadcast).not.toHaveBeenCalled()
    expect(context.notifyStateChanged).toHaveBeenCalledOnce()
  })

  it('falls back to broadcast when confirmation watching fails', async () => {
    const { service, bridge } = setup(async () => {
      throw new Error('watch unavailable')
    })
    await service.signTonConnectTransaction([{ address: recipient, amount: '1' }])
    expect(bridge.broadcast).toHaveBeenCalledOnce()
  })

  it('normalizes raw addresses before bridge preflight queries', async () => {
    const { service, context } = setup()
    const walletContract = WalletContractV5R1.create({ publicKey: Buffer.alloc(32, 1), workchain: 0 })
    const rawRecipient = `0:${'33'.repeat(32)}`
    const identity = {
      publicKey: walletContract.publicKey.toString('hex'),
      addressRaw: walletContract.address.toRawString(),
      revision: 1,
    }
    context.getAccountInformation.mockResolvedValue({ balance: '1000', status: 'active' })
    context.emulateTransaction.mockResolvedValue({
      accepted: true,
      success: true,
      exit_code: 0,
      total_fees: '10',
    })
    context.withPreflightState.mockImplementation((_expectedIdentity, operation) => operation(walletContract, 0))

    await service.preflightTransfer(rawRecipient, '1', undefined, identity)

    expect(context.getAccountInformation).toHaveBeenNthCalledWith(
      1,
      Address.parseRaw(rawRecipient).toString({ bounceable: false })
    )
    expect(context.getAccountInformation).toHaveBeenNthCalledWith(
      2,
      walletContract.address.toString({ bounceable: false })
    )
  })

  it('fails before signing when no bridge is available', async () => {
    const service = new WalletTransferService({
      getBridge: () => null,
      getAccountInformation: vi.fn(),
      emulateTransaction: vi.fn(),
      runMethod: vi.fn(),
      buildBoc: async () => ({ boc: '' }),
      withPreflightState: vi.fn(),
      withSigningState: vi.fn(),
      notifyStateChanged: () => {},
    })
    await expect(service.signTonConnectTransaction([{ address: recipient, amount: '1' }])).rejects.toThrow(
      'Bridge not connected'
    )
  })
})
