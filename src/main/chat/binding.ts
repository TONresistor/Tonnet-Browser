import type { MessengerBridgePort } from '../ports/ton-bridge'

const GET_CHALLENGE_QUERY = Buffer.from('a270d948', 'hex')
const CHALLENGE_RESPONSE_MAGIC = Buffer.from('4c34c713', 'hex')
const CHALLENGE_MAX_LIFETIME_S = 120

export interface BindingChallenge {
  nonceHex: string
  expires: number
}

export function parseBindingChallenge(data: Buffer, calibratedNowSec: number): BindingChallenge {
  if (data.length !== 40 || !data.subarray(0, 4).equals(CHALLENGE_RESPONSE_MAGIC)) {
    throw new Error('tonnet.getChallenge returned an invalid TL response')
  }
  const expires = data.readInt32LE(36)
  if (expires <= calibratedNowSec || expires > calibratedNowSec + CHALLENGE_MAX_LIFETIME_S) {
    throw new Error('tonnet.getChallenge returned an invalid expiry')
  }
  return { nonceHex: data.subarray(4, 36).toString('hex'), expires }
}

export async function requestBindingChallenge(
  bridge: MessengerBridgePort,
  overlayIdB64: string,
  calibratedNowSec: number
): Promise<BindingChallenge> {
  const response = await bridge.overlayQuery(overlayIdB64, GET_CHALLENGE_QUERY.toString('base64'), 3)
  return parseBindingChallenge(Buffer.from(response, 'base64'), calibratedNowSec)
}
