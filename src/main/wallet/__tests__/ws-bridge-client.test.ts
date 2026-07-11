import { afterEach, describe, expect, it, vi } from 'vitest'
import { WsBridgeClient } from '../ws-bridge-client'

afterEach(() => vi.useRealTimers())

describe('WsBridgeClient queued requests', () => {
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
