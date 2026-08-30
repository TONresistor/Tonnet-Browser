import type { MessengerBridgePort } from '../ports/ton-bridge'

const GET_TIME_QUERY = Buffer.from('5f6673f0', 'hex')
const TIME_RESPONSE_MAGIC = Buffer.from('47a0c32f', 'hex')
const MAX_CLOCK_OFFSET_S = 300
const REPLAY_MAX_AGE_S = 6 * 60 * 60 + 5 * 60
const REPLAY_MAX_FUTURE_S = 5 * 60

export function parseTonnetTime(data: Buffer): number {
  if (data.length !== 8 || !data.subarray(0, 4).equals(TIME_RESPONSE_MAGIC)) {
    throw new Error('tonnet.getTime returned an invalid TL response')
  }
  return data.readInt32LE(4)
}

export function isAcceptableFrameDate(dateSec: number, receivedAtSec: number, clockOffsetSec: number): boolean {
  const calibratedNow = receivedAtSec + clockOffsetSec
  return dateSec >= calibratedNow - REPLAY_MAX_AGE_S && dateSec <= calibratedNow + REPLAY_MAX_FUTURE_S
}

export async function measureClockOffset(
  bridge: MessengerBridgePort,
  overlayIdB64: string,
  nowMs: () => number = Date.now
): Promise<number> {
  const startedAt = nowMs()
  const response = await bridge.overlayQuery(overlayIdB64, GET_TIME_QUERY.toString('base64'), 3)
  const finishedAt = nowMs()
  const remoteNow = parseTonnetTime(Buffer.from(response, 'base64'))
  const localMidpoint = Math.floor((startedAt + finishedAt) / 2_000)
  const offset = remoteNow - localMidpoint
  if (Math.abs(offset) > MAX_CLOCK_OFFSET_S) {
    throw new Error(`Tonnet node clock differs by ${offset}s`)
  }
  return offset
}
