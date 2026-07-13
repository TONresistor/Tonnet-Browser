import { Address, Cell, internal, loadStateInit, type MessageRelaxed } from '@ton/core'
import type { TonConnectOutMessage } from '../tonconnect/types'
import { WALLET_MAX_TIMEOUT_S } from './constants'

export interface WalletBroadcastPort {
  sendAndWatch(boc: Buffer): Promise<string>
  broadcast(boc: Buffer): Promise<void>
}

export interface WalletTransferContext {
  getBridge(): WalletBroadcastPort | null
  buildBoc(messages: MessageRelaxed[], maxTimeout: number): Promise<{ boc: string }>
  notifyStateChanged(): void
}

/** Transaction construction and broadcast orchestration, separate from vault state. */
export class WalletTransferService {
  constructor(private readonly context: WalletTransferContext) {}

  async signTonConnectTransaction(messages: TonConnectOutMessage[]): Promise<string> {
    const bridge = this.context.getBridge()
    if (!bridge) throw new Error('Bridge not connected')

    const internalMessages = messages.map(toInternalMessage)
    const { boc } = await this.context.buildBoc(internalMessages, WALLET_MAX_TIMEOUT_S)
    const bytes = Buffer.from(boc, 'base64')
    try {
      await bridge.sendAndWatch(bytes)
    } catch {
      await bridge.broadcast(bytes)
    }
    this.context.notifyStateChanged()
    return boc
  }
}

function toInternalMessage(message: TonConnectOutMessage): MessageRelaxed {
  const { isBounceable, address } = Address.parseFriendly(message.address)
  return internal({
    to: address,
    value: BigInt(message.amount),
    bounce: isBounceable,
    body: message.payload ? Cell.fromBase64(message.payload) : undefined,
    init: message.stateInit ? loadStateInit(Cell.fromBase64(message.stateInit).beginParse()) : undefined,
  })
}
