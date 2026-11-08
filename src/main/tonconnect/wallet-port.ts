import type { SignDataPayloadInput, SignDataResult, TonConnectOutMessage, TonProofReplyPayload } from './types'
import type { TransferAuthorization, StructuredTransferItem } from '../../wallet-engine'

export interface TonConnectAccount {
  addressRaw: string
  publicKey: string
  walletStateInit: string
}

/** Capabilities TonConnect needs from a wallet, independent of its implementation. */
export interface TonConnectWalletPort {
  getState(): { isLocked?: boolean; needsPasswordSetup?: boolean; walletVersion?: string }
  unlock(password: string, signal?: AbortSignal): Promise<unknown>
  getSessionRevision?(): number
  getTonConnectAccount(): TonConnectAccount | null
  resolveTonConnectItems(
    items: readonly StructuredTransferItem[],
    expectedAddress: string,
    expectedSession?: number,
    signal?: AbortSignal
  ): Promise<TonConnectOutMessage[]>
  signTonConnectMessage(
    messages: TonConnectOutMessage[],
    expectedAddress: string,
    operationId: string,
    validUntil: number | undefined,
    expectedSession: number | undefined,
    authorize: TransferAuthorization,
    signal?: AbortSignal
  ): Promise<string>
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
    authorize?: TransferAuthorization,
    signal?: AbortSignal
  ): Promise<string>
  signData(
    domain: string,
    payload: SignDataPayloadInput,
    expectedAddress: string,
    expectedSession?: number,
    signal?: AbortSignal
  ): Promise<SignDataResult>
}
