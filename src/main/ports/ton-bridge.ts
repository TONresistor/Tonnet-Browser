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
  overlayConnectAndJoin(anchorAdnlB64: string, overlayIdB64: string): Promise<string>
  overlaySendRaw(overlayIdB64: string, dataB64: string): Promise<void>
  adnlPing(peerId: string): Promise<void>
  overlayLeaveAndDisconnect(overlayIdB64: string, peerId: string): Promise<void>
  onOverlayMessage(callback: (data: { overlay_id: string; message: string; trusted?: boolean }) => void): () => void
}

export function isContractNotDeployedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('not initialized') || message.includes('-256')
}
