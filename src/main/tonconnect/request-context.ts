import type { TonConnectFetchSession } from './manifest-loader'

/** Minimal WebContents surface required by TonConnect application workflows. */
export interface TonConnectSenderPort {
  session: TonConnectFetchSession
  once(event: 'destroyed', listener: () => void): unknown
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

export interface TonConnectRequestContext {
  sender: TonConnectSenderPort
}
