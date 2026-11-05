import { afterEach, describe, expect, it, vi } from 'vitest'
import { Address } from '@ton/core'
import { WsBridgeClient } from '../ws-bridge-client'
import fixture from './fixtures/tonutils-bridge-v0.5.1.json'

afterEach(() => vi.useRealTimers())

describe('WsBridgeClient queued requests', () => {
  it('invalidates connection-scoped reads when the client is disconnected', () => {
    const client = new WsBridgeClient(1)
    const revision = client.getConnectionRevision()
    client.disconnect()
    expect(client.getConnectionRevision()).toBeGreaterThan(revision)
  })
  it('rejects a request whose reconnect queue budget expires', async () => {
    vi.useFakeTimers()
    const client = new WsBridgeClient(1)

    const request = (
      client as unknown as {
        request(method: string, params: Record<string, unknown>, guard: undefined, timeoutMs: number): Promise<unknown>
      }
    ).request('wallet.queued', {}, undefined, 100)

    const rejection = expect(request).rejects.toThrow('Request timeout: wallet.queued')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    client.disconnect()
  })
})

describe('wallet bridge address encoding', () => {
  const raw = '0:' + '11'.repeat(32)
  const friendly = Address.parseRaw(raw).toString({ bounceable: false })

  function clientWithRpc(result: unknown) {
    const client = new WsBridgeClient(1)
    const rpc = vi
      .spyOn(
        client as unknown as { request(method: string, params: Record<string, unknown>): Promise<unknown> },
        'request'
      )
      .mockImplementation(async (_method, params) => {
        if (params.address !== friendly) throw new Error('invalid address')
        return result
      })
    return { client, rpc }
  }

  it.each(['raw', 'friendly'])('reads a wallet snapshot using a %s address', async (format) => {
    const snapshot = { ...fixture.responses['wallet.getSnapshot'], address: friendly }
    const { client, rpc } = clientWithRpc(snapshot)
    await expect(client.getWalletSnapshot(format === 'raw' ? raw : friendly)).resolves.toMatchObject({
      address: friendly,
      seqno: 0,
    })
    expect(rpc).toHaveBeenCalledWith('wallet.getSnapshot', { address: friendly })
    client.disconnect()
  })

  it.each(['raw', 'friendly'])('reads transaction evidence using a %s address', async (format) => {
    const { client, rpc } = clientWithRpc({ transactions: [] })
    await expect(
      client.getRawTransactions(format === 'raw' ? raw : friendly, 100, '42', 'ab'.repeat(32))
    ).resolves.toEqual([])
    expect(rpc).toHaveBeenCalledWith('lite.getTransactions', {
      address: friendly,
      limit: 100,
      last_lt: '42',
      last_hash: 'ab'.repeat(32),
      include_boc: true,
    })
    client.disconnect()
  })

  it('preserves the verified emulation context and requests final wallet revalidation', async () => {
    const snapshot = { ...fixture.responses['wallet.getSnapshot'], address: friendly, emulation_context: 'wallet_1' }
    const { client, rpc } = clientWithRpc(snapshot)
    await expect(client.getWalletSnapshot(raw, true)).resolves.toMatchObject({ emulation_context: 'wallet_1' })
    expect(rpc).toHaveBeenLastCalledWith('wallet.getSnapshot', { address: friendly, prepare_emulation: true })
    rpc.mockResolvedValue({ ...fixture.responses['lite.emulateTransaction'], wallet_snapshot: snapshot })
    await expect(
      client.emulateTransaction(friendly, 'unsigned-boc', { id: 'wallet_1', revalidate: true })
    ).resolves.toMatchObject({ wallet_snapshot: snapshot, total_fees: '42' })
    expect(rpc).toHaveBeenLastCalledWith('lite.emulateTransaction', {
      address: friendly,
      boc: 'unsigned-boc',
      ignore_chksig: true,
      emulation_context: 'wallet_1',
      revalidate_wallet: true,
    })
    client.disconnect()
  })

  it('keeps standalone emulation requests compatible and rejects malformed signing snapshots', async () => {
    const { client, rpc } = clientWithRpc(fixture.responses['lite.emulateTransaction'])
    await client.emulateTransaction(friendly, 'unsigned-boc')
    expect(rpc).toHaveBeenLastCalledWith('lite.emulateTransaction', {
      address: friendly,
      boc: 'unsigned-boc',
      ignore_chksig: true,
    })
    rpc.mockResolvedValue({ ...fixture.responses['lite.emulateTransaction'], wallet_snapshot: { seqno: -1 } })
    await expect(
      client.emulateTransaction(friendly, 'unsigned-boc', { id: 'wallet_1', revalidate: true })
    ).rejects.toThrow()
    client.disconnect()
  })

  it('passes the observed master block to transaction evidence requests', async () => {
    const { client, rpc } = clientWithRpc({ transactions: [] })
    await client.getRawTransactions(raw, 100, '42', 'ab'.repeat(32), 123)
    expect(rpc).toHaveBeenCalledWith('lite.getTransactions', {
      address: friendly,
      limit: 100,
      last_lt: '42',
      last_hash: 'ab'.repeat(32),
      include_boc: true,
      master_seqno: 123,
    })
    client.disconnect()
  })
})

describe('broadcast acknowledgement', () => {
  it.each([0, undefined])(
    'rejects an unaccepted status %s instead of reporting a successful broadcast',
    async (status) => {
      const client = new WsBridgeClient(1)
      vi.spyOn(client as unknown as { request(): Promise<unknown> }, 'request').mockResolvedValue({ status })
      await expect(client.broadcast(Buffer.from('signed-message'))).rejects.toThrow('did not accept')
      client.disconnect()
    }
  )

  it('accepts the explicit liteserver success status', async () => {
    const client = new WsBridgeClient(1)
    vi.spyOn(client as unknown as { request(): Promise<unknown> }, 'request').mockResolvedValue({ status: 1 })
    await expect(client.broadcast(Buffer.from('signed-message'))).resolves.toBeUndefined()
    client.disconnect()
  })
})
