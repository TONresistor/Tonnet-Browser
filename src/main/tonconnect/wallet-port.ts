import type { SignDataPayloadInput, SignDataResult, TonConnectOutMessage, TonProofReplyPayload } from './types'

export interface TonConnectAccount {
  addressRaw: string
  publicKey: string
  walletStateInit: string
}

/** Capabilities TonConnect needs from a wallet, independent of its implementation. */
export interface TonConnectWalletPort {
  getTonConnectAccount(): TonConnectAccount | null
  signTonProof(domain: string, payload: string): Promise<TonProofReplyPayload>
  signTonConnectTransaction(messages: TonConnectOutMessage[]): Promise<string>
  signData(domain: string, payload: SignDataPayloadInput): Promise<SignDataResult>
}
