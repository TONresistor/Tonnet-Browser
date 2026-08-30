import { describe, expect, it, vi } from 'vitest'
import type { MessengerBridgePort } from '../../ports/ton-bridge'
import { isAcceptableFrameDate, measureClockOffset, parseTonnetTime } from '../time'

function response(now: number): string {
  const data = Buffer.alloc(8)
  Buffer.from('47a0c32f', 'hex').copy(data)
  data.writeInt32LE(now, 4)
  return data.toString('base64')
}

describe('Tonnet overlay time', () => {
  it('parses tonnet.time and uses the request midpoint', async () => {
    const bridge = {
      overlayQuery: vi.fn(async () => response(1_003)),
    } as unknown as MessengerBridgePort
    const ticks = [1_000_000, 1_002_000]

    await expect(measureClockOffset(bridge, 'overlay', () => ticks.shift() as number)).resolves.toBe(2)
    expect(bridge.overlayQuery).toHaveBeenCalledWith('overlay', 'X2Zz8A==', 3)
  })

  it('rejects malformed responses and offsets over five minutes', async () => {
    expect(() => parseTonnetTime(Buffer.alloc(8))).toThrow('invalid TL response')
    const bridge = {
      overlayQuery: vi.fn(async () => response(2_000)),
    } as unknown as MessengerBridgePort
    await expect(measureClockOffset(bridge, 'overlay', () => 1_000_000)).rejects.toThrow('differs')
  })

  it('bounds live and replayed wrappers against calibrated node time', () => {
    const receivedAt = 50_000
    const offset = 120
    const calibrated = receivedAt + offset
    expect(isAcceptableFrameDate(calibrated - (6 * 60 * 60 + 5 * 60), receivedAt, offset)).toBe(true)
    expect(isAcceptableFrameDate(calibrated + 5 * 60, receivedAt, offset)).toBe(true)
    expect(isAcceptableFrameDate(calibrated - (6 * 60 * 60 + 5 * 60) - 1, receivedAt, offset)).toBe(false)
    expect(isAcceptableFrameDate(calibrated + 5 * 60 + 1, receivedAt, offset)).toBe(false)
  })
})
