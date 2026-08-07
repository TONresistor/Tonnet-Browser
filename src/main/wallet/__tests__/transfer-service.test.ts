import { Address, beginCell } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { WalletTransferService } from '../transfer-service'

const recipient = Address.parseRaw(`0:${'33'.repeat(32)}`).toString({ bounceable: false })

function setup(sendAndWatch: () => Promise<string> = async () => 'hash') {
  const bridge = { sendAndWatch: vi.fn(sendAndWatch), broadcast: vi.fn(async () => {}) }
  const context = {
    getBridge: () => bridge,
    buildBoc: vi.fn(async () => ({ boc: beginCell().storeUint(1, 1).endCell().toBoc().toString('base64') })),
    notifyStateChanged: vi.fn(),
  }
  return { bridge, context, service: new WalletTransferService(context) }
}

describe('WalletTransferService', () => {
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

  it('fails before signing when no bridge is available', async () => {
    const service = new WalletTransferService({
      getBridge: () => null,
      buildBoc: async () => ({ boc: '' }),
      notifyStateChanged: () => {},
    })
    await expect(service.signTonConnectTransaction([{ address: recipient, amount: '1' }])).rejects.toThrow(
      'Bridge not connected'
    )
  })
})
