import { describe, expect, it, vi } from 'vitest'
import type { MessengerBridgePort } from '../../ports/ton-bridge'
import { parseBindingChallenge, requestBindingChallenge, requestSessionChallenge } from '../binding'

function response(expires: number): Buffer {
  const data = Buffer.alloc(40)
  Buffer.from('4c34c713', 'hex').copy(data)
  Buffer.alloc(32, 0x42).copy(data, 4)
  data.writeInt32LE(expires, 36)
  return data
}

describe('Tonnet connection binding challenge', () => {
  it('parses a bounded challenge and sends the direct boxed TL query', async () => {
    const bridge = {
      overlayQuery: vi.fn(async () => response(1_060).toString('base64')),
    } as unknown as MessengerBridgePort
    await expect(requestBindingChallenge(bridge, 'overlay', 1_000)).resolves.toEqual({
      nonceHex: '42'.repeat(32),
      expires: 1_060,
    })
    expect(bridge.overlayQuery).toHaveBeenCalledWith('overlay', 'onDZSA==', 3)
  })

  it('rejects malformed, expired, and implausibly long challenges', () => {
    expect(() => parseBindingChallenge(Buffer.alloc(40), 1_000)).toThrow('invalid TL response')
    expect(() => parseBindingChallenge(response(1_000), 1_000)).toThrow('invalid expiry')
    expect(() => parseBindingChallenge(response(1_121), 1_000)).toThrow('invalid expiry')
  })

  it('requests a replay-capable challenge for each logical room session', async () => {
    const bridge = {
      overlayQuery: vi.fn(async () => response(1_060).toString('base64')),
    } as unknown as MessengerBridgePort

    await expect(requestSessionChallenge(bridge, 'overlay', 1_000)).resolves.toEqual({
      nonceHex: '42'.repeat(32),
      expires: 1_060,
    })
    expect(bridge.overlayQuery).toHaveBeenCalledWith('overlay', 'KT5ysw==', 3)
  })

  it('falls back to the legacy challenge on older nodes', async () => {
    const bridge = {
      overlayQuery: vi
        .fn()
        .mockRejectedValueOnce(new Error('unsupported query'))
        .mockResolvedValueOnce(response(1_060).toString('base64')),
    } as unknown as MessengerBridgePort

    await expect(requestSessionChallenge(bridge, 'overlay', 1_000)).resolves.toEqual({
      nonceHex: '42'.repeat(32),
      expires: 1_060,
    })
    expect(bridge.overlayQuery).toHaveBeenNthCalledWith(1, 'overlay', 'KT5ysw==', 3)
    expect(bridge.overlayQuery).toHaveBeenNthCalledWith(2, 'overlay', 'onDZSA==', 3)
  })
})
