import type { SignDataPayloadInput, SignDataResult, TonConnectOutMessage, TonProofReplyPayload } from './types'
import type { TransferAuthorization } from '../../wallet-engine'

export interface TonConnectAccount {
  addressRaw: string
  publicKey: string
  walletStateInit: string
}

/** Capabilities TonConnect needs from a wallet, independent of its implementation. */
export interface TonConnectWalletPort {
  getSessionRevision?(): number
  getTonConnectAccount(): TonConnectAccount | null
  signTonProof(
    domain: string,
    payload: string,
    expectedAddress: string,
    expectedSession?: number
  ): Promise<TonProofReplyPayload>
  signTonConnectTransaction(
    messages: TonConnectOutMessage[],
    expectedAddress: string,
    operationId?: string,
    validUntil?: number,
    expectedSession?: number,
    authorize?: TransferAuthorization
  ): Promise<string>
  signData(
    domain: string,
    payload: SignDataPayloadInput,
    expectedAddress: string,
    expectedSession?: number
  ): Promise<SignDataResult>
}
