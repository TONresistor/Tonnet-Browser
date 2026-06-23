export const TONCONNECT_PROTOCOL_VERSION = 2
export const TON_MAINNET_CHAIN = '-239'
export const TONCONNECT_MAX_MESSAGES = 4

export const TONCONNECT_ERROR = {
  UNKNOWN: 0,
  BAD_REQUEST: 1,
  UNKNOWN_APP: 100,
  USER_DECLINED: 300,
  METHOD_NOT_SUPPORTED: 400,
} as const

export const CONNECT_ERROR = {
  UNKNOWN: 0,
  BAD_REQUEST: 1,
  MANIFEST_NOT_FOUND: 2,
  MANIFEST_CONTENT_ERROR: 3,
  UNKNOWN_APP: 100,
  USER_DECLINED: 300,
  METHOD_NOT_SUPPORTED: 400,
} as const

export interface TonAddressItem {
  name: 'ton_addr'
}

export interface TonProofItem {
  name: 'ton_proof'
  payload: string
}

export type ConnectItem = TonAddressItem | TonProofItem

export interface ConnectRequest {
  manifestUrl: string
  items: ConnectItem[]
}

export interface AppManifest {
  url: string
  name: string
  iconUrl: string
  termsOfUseUrl?: string
  privacyPolicyUrl?: string
}

export interface DeviceFeature {
  name: string
  maxMessages?: number
  extraCurrencySupported?: boolean
  types?: string[]
}

export interface DeviceInfo {
  platform: string
  appName: string
  appVersion: string
  maxProtocolVersion: number
  features: DeviceFeature[]
}

export interface TonAddressItemReply {
  name: 'ton_addr'
  address: string
  network: string
  publicKey: string
  walletStateInit: string
}

export interface TonProofReplyPayload {
  timestamp: string
  domain: { lengthBytes: number; value: string }
  signature: string
  payload: string
}

export type TonProofItemReply =
  | { name: 'ton_proof'; proof: TonProofReplyPayload }
  | { name: 'ton_proof'; error: { code: number; message?: string } }

export type ConnectItemReply = TonAddressItemReply | TonProofItemReply

export interface ConnectEventSuccess {
  event: 'connect'
  id: number
  payload: { items: ConnectItemReply[]; device: DeviceInfo }
}

export interface ConnectEventError {
  event: 'connect_error'
  id: number
  payload: { code: number; message: string }
}

export type ConnectEvent = ConnectEventSuccess | ConnectEventError

export interface DisconnectEvent {
  event: 'disconnect'
  id: number
  payload: Record<string, never>
}

export type WalletEvent = ConnectEvent | DisconnectEvent

export interface AppRequest {
  method: string
  params: string[]
  id: string
}

export type WalletResponse =
  | { result: string | object; id: string }
  | { error: { code: number; message: string; data?: unknown }; id: string }

export interface TonConnectOutMessage {
  address: string
  amount: string
  payload?: string
  stateInit?: string
}

export type SignDataPayloadInput =
  | { type: 'text'; text: string }
  | { type: 'binary'; bytes: string }
  | { type: 'cell'; schema: string; cell: string }

export interface SignDataResult {
  signature: string
  address: string
  timestamp: number
  domain: string
  payload: SignDataPayloadInput
}
