import type {
  DecryptDataPayloadInput,
  EncryptDataPayloadInput,
  SignDataPayloadInput,
  SignDataResult,
  TonConnectOutMessage,
  TonProofReplyPayload,
} from './types'

export interface TonConnectAccount {
  addressRaw: string
  publicKey: string
  walletStateInit: string
}

/** Capabilities TonConnect needs from a wallet, independent of its implementation. */
export interface TonConnectWalletPort {
  getTonConnectAccount(): TonConnectAccount | null
  signTonProof(domain: string, payload: string, expectedAddress: string): Promise<TonProofReplyPayload>
  signTonConnectTransaction(messages: TonConnectOutMessage[], expectedAddress: string): Promise<string>
  signData(domain: string, payload: SignDataPayloadInput, expectedAddress: string): Promise<SignDataResult>
  /** Encrypt `payload.bytes` to `payload.recipientPublicKey`, returning a raw base64 envelope. */
  encryptData(payload: EncryptDataPayloadInput, expectedAddress: string): Promise<string>
  /** Recover the plaintext of a raw base64 envelope encrypted by `payload.salt`. */
  decryptData(payload: DecryptDataPayloadInput, expectedAddress: string): Promise<string>
}
