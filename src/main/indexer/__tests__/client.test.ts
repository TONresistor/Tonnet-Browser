import { describe, expect, it, vi } from 'vitest'
import { TonIndexerClient, TonIndexerDisabledError } from '../client'

const transaction = {
  hash: Buffer.alloc(32, 7).toString('base64'),
  lt: '42',
  now: 1,
  total_fees: '2',
  block_ref: { seqno: 10, shard: '8000000000000000', workchain: 0 },
  description: { aborted: false },
  in_msg: null,
  out_msgs: [],
}

describe('TonIndexerClient', () => {
  it('does not make clearnet requests while the fallback is disabled', async () => {
    const fetchFn = vi.fn()
    const client = new TonIndexerClient(() => ({ enabled: false, endpoint: 'https://toncenter.com/api/v3' }), {
      fetch: fetchFn,
    })

    await expect(client.getTransactions({ account: 'EQAccount', limit: 10 })).rejects.toBeInstanceOf(
      TonIndexerDisabledError
    )
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('uses the configured endpoint, key and LT cursor', async () => {
    const fetchFn = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json({ transactions: [transaction] })
    )
    const client = new TonIndexerClient(
      () => ({ enabled: true, endpoint: 'https://indexer.example/api/v3/', apiKey: 'secret' }),
      { fetch: fetchFn }
    )

    const result = await client.getTransactions({ account: 'EQAccount', limit: 100, beforeLt: '42' })

    const [input, init] = fetchFn.mock.calls[0]
    const url = input as URL
    expect(url.origin + url.pathname).toBe('https://indexer.example/api/v3/transactions')
    expect(url.searchParams.get('account')).toBe('EQAccount')
    expect(url.searchParams.get('end_lt')).toBe('41')
    expect(init?.headers).toMatchObject({ 'X-Api-Key': 'secret' })
    expect(result).toHaveLength(1)
  })

  it('rejects remote HTTP endpoints while allowing local HTTP endpoints', async () => {
    const fetchFn = vi.fn(async () => Response.json({ transactions: [] }))
    const remote = new TonIndexerClient(() => ({ enabled: true, endpoint: 'http://indexer.example/api/v3' }), {
      fetch: fetchFn,
    })
    const local = new TonIndexerClient(() => ({ enabled: true, endpoint: 'http://127.0.0.1:8080/api/v3' }), {
      fetch: fetchFn,
    })

    await expect(remote.getTransactions({ account: 'EQAccount', limit: 10 })).rejects.toThrow(
      'Remote indexer endpoints must use HTTPS'
    )
    await expect(local.getTransactions({ account: 'EQAccount', limit: 10 })).resolves.toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('retries HTTP 429 responses through the shared queue', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(Response.json({ transactions: [] }))
    const sleep = vi.fn(async () => undefined)
    const client = new TonIndexerClient(
      () => ({ enabled: true, endpoint: 'https://toncenter.com/api/v3', apiKey: 'secret' }),
      { fetch: fetchFn, sleep }
    )

    await expect(client.getTransactions({ account: 'EQAccount', limit: 10 })).resolves.toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(0)
  })
})
