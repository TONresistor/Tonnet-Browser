import { Address, beginCell, Cell } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { resolveStructuredTransfers, type StructuredTransferItem } from '../structured-transfers'

const owner = Address.parseRaw(`0:${'11'.repeat(32)}`)
const recipient = Address.parseRaw(`0:${'22'.repeat(32)}`)
const master = Address.parseRaw(`0:${'33'.repeat(32)}`)
const asset = Address.parseRaw(`0:${'44'.repeat(32)}`)
const encodedAddress = (value: Address) => beginCell().storeAddress(value).endCell().toBoc().toString('base64')
const result = (stack: unknown[]) => ({ exit_code: 0, stack })
const jetton = { type: 'jetton' as const, master: master.toString(), destination: recipient.toString(), amount: '7' }
const nft = { type: 'nft' as const, nftAddress: asset.toString(), newOwner: recipient.toString() }

function setup(balance = '10', assetOwner = owner, assetMaster = master) {
  const bridge = {
    runMethod: vi.fn(async (_address: string, method: string, _params?: unknown[]) => {
      if (method === 'get_wallet_address') return result([encodedAddress(asset)])
      if (method === 'get_wallet_data')
        return result([balance, encodedAddress(assetOwner), encodedAddress(assetMaster)])
      return result(['-1', '42', encodedAddress(master), encodedAddress(assetOwner)])
    }),
  }
  const current = vi.fn()
  return {
    bridge,
    current,
    resolve: (items: StructuredTransferItem[]) =>
      resolveStructuredTransfers(items, owner.toRawString(), bridge, current),
  }
}

describe('TON Connect structured transfers', () => {
  it('keeps native transfer bodies and deployment state without asset queries', async () => {
    const s = setup()
    const payload = beginCell().storeUint(1, 1).endCell().toBoc().toString('base64')
    expect(
      await s.resolve([{ type: 'ton', address: recipient.toString(), amount: '9', payload, stateInit: payload }])
    ).toEqual([{ address: recipient.toString(), amount: '9', payload, stateInit: payload }])
    expect(s.bridge.runMethod).not.toHaveBeenCalled()
  })

  it('resolves a jetton wallet and encodes all TEP-74 transfer fields', async () => {
    const s = setup()
    const data = beginCell().storeUint(17, 8).endCell()
    const [message] = await s.resolve([
      {
        ...jetton,
        queryId: '5',
        attachAmount: '90000000',
        forwardAmount: '3',
        customPayload: data.toBoc().toString('base64'),
        forwardPayload: data.toBoc().toString('base64'),
      },
    ])
    expect(s.bridge.runMethod).toHaveBeenCalledWith(master.toString(), 'get_wallet_address', [
      { type: 'slice', boc: encodedAddress(owner) },
    ])
    expect(Address.parseFriendly(message.address).isBounceable).toBe(true)
    expect(Address.parse(message.address).equals(asset)).toBe(true)
    expect(message.amount).toBe('90000000')
    const slice = Cell.fromBase64(message.payload!).beginParse()
    expect(slice.loadUint(32)).toBe(0x0f8a7ea5)
    expect(slice.loadUintBig(64)).toBe(5n)
    expect(slice.loadCoins()).toBe(7n)
    expect(slice.loadAddress().equals(recipient)).toBe(true)
    expect(slice.loadAddress().equals(owner)).toBe(true)
    expect(slice.loadMaybeRef()?.equals(data)).toBe(true)
    expect(slice.loadCoins()).toBe(3n)
    expect(slice.loadBit()).toBe(true)
    expect(slice.loadRef().equals(data)).toBe(true)
    slice.endParse()
  })

  it.each(['owner', 'master', 'balance', 'batch-balance'])('rejects a jetton %s mismatch', async (failure) => {
    const s = setup(
      failure === 'balance' ? '6' : '10',
      failure === 'owner' ? recipient : owner,
      failure === 'master' ? recipient : master
    )
    await expect(s.resolve(failure === 'batch-balance' ? [jetton, jetton] : [jetton])).rejects.toThrow()
  })

  it('checks NFT ownership and encodes the TEP-62 transfer with an empty inline forward payload', async () => {
    const s = setup()
    const [message] = await s.resolve([nft])
    const slice = Cell.fromBase64(message.payload!).beginParse()
    expect(slice.loadUint(32)).toBe(0x5fcc3d14)
    expect(slice.loadUintBig(64)).toBe(0n)
    expect(slice.loadAddress().equals(recipient)).toBe(true)
    expect(slice.loadAddress().equals(owner)).toBe(true)
    expect(slice.loadMaybeRef()).toBeNull()
    expect(slice.loadCoins()).toBe(1n)
    expect(slice.loadBit()).toBe(false)
    slice.endParse()
  })

  it('refuses NFTs belonging to another account and duplicate transfers', async () => {
    await expect(setup('10', recipient).resolve([nft])).rejects.toThrow('not owned')
    await expect(setup().resolve([nft, nft])).rejects.toThrow('Duplicate')
  })

  it('stops asset resolution when the pending request is cancelled', async () => {
    const s = setup()
    const controller = new AbortController()
    s.bridge.runMethod.mockImplementationOnce(async () => {
      controller.abort()
      return result([encodedAddress(asset)])
    })
    await expect(
      resolveStructuredTransfers([jetton], owner.toRawString(), s.bridge, () => controller.signal.throwIfAborted())
    ).rejects.toThrow()
    expect(s.bridge.runMethod).toHaveBeenCalledTimes(1)
  })

  it('refuses failed get methods and invalid asset funding before building a message', async () => {
    const s = setup()
    s.bridge.runMethod.mockResolvedValueOnce({ exit_code: 13, stack: [] })
    await expect(s.resolve([jetton])).rejects.toThrow('get method failed')
    await expect(setup().resolve([{ ...nft, attachAmount: '1', forwardAmount: '1' }])).rejects.toThrow(
      'Attached amount'
    )
  })
})
