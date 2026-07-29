export interface AccountInformationResult {
  balance: string
  status: 'active' | 'uninit' | 'frozen'
}

export interface EmulateTransactionResult {
  accepted: boolean
  success: boolean
  exit_code: number
  total_fees: string
  fees?: {
    storage_fee: string
    gas_fee: string
    fwd_fee: string
    action_fee: string
  }
}

export interface BridgeAccountState {
  address: string
  balance: string
  status: 'active' | 'uninit' | 'frozen'
  last_tx_lt: string
  last_tx_hash: string
  block_seqno: number
}

export interface BridgeMessage {
  source: string
  destination: string
  value: string
  body?: string
}

export interface BridgeTransaction {
  hash: string
  lt: string
  now: number
  total_fees?: string
  in_msg?: BridgeMessage
  out_msgs?: BridgeMessage[] | null
}

/** Minimal TON bridge capability required by Cocoon on-chain workflows. */
export interface TonBridgePort {
  getBalance(address: string): Promise<string>
  getSeqno(address: string): Promise<number>
  broadcast(boc: Buffer): Promise<void>
  runMethod(address: string, method: string, params?: unknown[]): Promise<unknown>
}

/** Overlay/DHT capabilities required by Messenger, without transport exposure. */
export interface MessengerBridgePort {
  dhtFindValue(keyIdB64: string, name: string, index?: number): Promise<{ data: string; ttl: number } | null>
  dhtFindOverlayNodes(overlayKeyB64: string): Promise<{
    nodes: Array<{ id: string; adnl_id: string; overlay: string; version: number }>
    count: number
  }>
  overlayConnectAndJoin(anchorAdnlB64: string, overlayIdB64: string): Promise<string>
  overlaySendRaw(overlayIdB64: string, dataB64: string): Promise<void>
  overlayQuery(overlayIdB64: string, dataB64: string, timeoutSec?: number): Promise<string>
  adnlPing(peerId: string): Promise<void>
  overlayLeaveAndDisconnect(overlayIdB64: string, peerId: string): Promise<void>
  onOverlayMessage(callback: (data: { overlay_id: string; message: string; trusted?: boolean }) => void): () => void
}

export function isContractNotDeployedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('not initialized') || message.includes('-256')
}
