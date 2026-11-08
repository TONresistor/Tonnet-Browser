export interface TonProofReplyPayload {
  timestamp: number // UNIX seconds — MUST be a number per TON Connect spec; @tonconnect/sdk rejects a string with "Invalid 'proof.timestamp'"
  domain: { lengthBytes: number; value: string }
  signature: string
  payload: string
}

export interface TonConnectOutMessage {
  address: string
  amount: string
  payload?: string
  stateInit?: string
}

export type SignDataPayloadInput = (
  | { type: 'text'; text: string }
  | { type: 'binary'; bytes: string }
  | { type: 'cell'; schema: string; cell: string }
) & { network?: string; from?: string }

export interface SignDataResult {
  signature: string
  address: string
  timestamp: number
  domain: string
  payload: SignDataPayloadInput
}

export interface TonConnectAccount {
  addressRaw: string
  publicKey: string
  walletStateInit: string
}
