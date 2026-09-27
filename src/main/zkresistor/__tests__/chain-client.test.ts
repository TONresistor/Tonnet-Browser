import { Address } from '@ton/core'
import { describe, expect, it, vi } from 'vitest'
import { TonIndexerClient, TonIndexerDisabledError } from '../../indexer/client'
import type { ZkResistorBridgePort } from '../../ports/zkresistor-bridge'
import { ZkResistorChainClient } from '../chain-client'

const address = Address.parseRaw(`0:${'11'.repeat(32)}`).toString({ bounceable: true, urlSafe: true })
const hash = Buffer.alloc(32, 7).toString('base64')

function bridgeStub(): ZkResistorBridgePort {
  return {
    getAccountInformation: vi.fn(),
    runMethod: vi.fn(),
  }
}

describe('ZkResistorChainClient explicit history source', () => {
  it('reads indexed history directly without issuing a Bridge request', async () => {
    const fetchFn = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({
        transactions: [
          {
            hash,
            lt: '42',
            now: 1,
            block_ref: { seqno: 10 },
            description: { aborted: false },
            in_msg: null,
            out_msgs: [
              { destination: null, value: null, message_content: { body: 'te6ccgEBAQEAAgAAAA==' } },
              { destination: address, value: '100', message_content: { body: 'te6ccgEBAQEAAgAAAA==' } },
            ],
          },
        ],
      })
    )
    const indexer = new TonIndexerClient(
      () => ({ enabled: true, endpoint: 'https://toncenter.com/api/v3', apiKey: 'secret' }),
      { fetch: fetchFn }
    )
    const bridge = bridgeStub()
    const client = new ZkResistorChainClient(bridge, indexer)

    await expect(client.getTransactions(address, 100, { lt: '43', hash })).resolves.toEqual({
      transactions: [
        {
          lt: '42',
          hash,
          block_seqno: 10,
          success: true,
          out_msgs: [
            { index: 0, isExternal: true, body: 'te6ccgEBAQEAAgAAAA==' },
            { index: 1, isExternal: false, body: 'te6ccgEBAQEAAgAAAA==' },
          ],
        },
      ],
      incomplete: false,
    })
    const url = fetchFn.mock.calls[0][0] as URL
    expect(url.searchParams.get('end_lt')).toBe('42')
    expect(url.searchParams.get('account')).toBe(address)
    expect(bridge.getAccountInformation).not.toHaveBeenCalled()
    expect(bridge.runMethod).not.toHaveBeenCalled()
  })

  it('rejects a disabled indexer without making network requests', async () => {
    const fetchFn = vi.fn()
    const indexer = new TonIndexerClient(() => ({ enabled: false, endpoint: 'https://toncenter.com/api/v3' }), {
      fetch: fetchFn,
    })
    const bridge = bridgeStub()
    const client = new ZkResistorChainClient(bridge, indexer)
    await expect(client.getTransactions(address, 100, undefined)).rejects.toBeInstanceOf(TonIndexerDisabledError)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(bridge.getAccountInformation).not.toHaveBeenCalled()
    expect(bridge.runMethod).not.toHaveBeenCalled()
  })

  it('rejects replay when no indexer has been supplied', async () => {
    const client = new ZkResistorChainClient(bridgeStub())
    await expect(client.getTransactions(address, 100, undefined)).rejects.toBeInstanceOf(TonIndexerDisabledError)
  })

  it('keeps contract reads on the Bridge and preserves their failures', async () => {
    const bridge = bridgeStub()
    vi.mocked(bridge.getAccountInformation).mockRejectedValue(new Error('Bridge disconnected'))
    const fetchFn = vi.fn()
    const indexer = new TonIndexerClient(() => ({ enabled: true, endpoint: 'https://toncenter.com/api/v3' }), {
      fetch: fetchFn,
    })
    const client = new ZkResistorChainClient(bridge, indexer)
    await expect(client.getAccountState(address)).rejects.toThrow('Bridge disconnected')
    expect(bridge.getAccountInformation).toHaveBeenCalledWith(address)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
