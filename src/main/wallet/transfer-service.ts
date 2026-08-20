import { Address, Cell, internal, loadStateInit, type MessageRelaxed } from '@ton/core'
import type { TonConnectOutMessage } from '../tonconnect/types'
import { WALLET_MAX_TIMEOUT_S } from './constants'
import type { WalletTransaction } from '../../shared/types'
import type { WalletIdentitySnapshot } from './wallet-identity'
import type { WalletContractShape } from './wallet-versions'
import { createTonTransferMessage } from './transfer-message'
import { preflightTonTransfer, type TransferPreflightResult } from './transfer-preflight'
import type { AccountInformationResult } from './bridge-codecs'
import type { EmulateTransactionResult } from './bridge-codecs'

export interface WalletBroadcastPort {
  sendAndWatch(boc: Buffer): Promise<string>
  broadcast(boc: Buffer): Promise<void>
}

export interface WalletTransferContext {
  getBridge(): WalletBroadcastPort | null
  getAccountInformation(address: string): Promise<AccountInformationResult>
  emulateTransaction(address: string, boc: string): Promise<EmulateTransactionResult>
  buildBoc(
    messages: MessageRelaxed[],
    maxTimeout: number,
    expectedAddress?: string,
    expectedIdentity?: WalletIdentitySnapshot
  ): Promise<{ boc: string }>
  withPreflightState<T>(
    expectedIdentity: WalletIdentitySnapshot,
    operation: (walletContract: WalletContractShape, seqno: number) => Promise<T>
  ): Promise<T>
  notifyStateChanged(): void
}

/** Transaction construction and broadcast orchestration, separate from vault state. */
export class WalletTransferService {
  constructor(private readonly context: WalletTransferContext) {}

  async signTonConnectTransaction(messages: TonConnectOutMessage[], expectedAddress?: string): Promise<string> {
    const bridge = this.context.getBridge()
    if (!bridge) throw new Error('Bridge not connected')

    const internalMessages = messages.map(toInternalMessage)
    const { boc } = await this.context.buildBoc(internalMessages, WALLET_MAX_TIMEOUT_S, expectedAddress)
    const bytes = Buffer.from(boc, 'base64')
    try {
      await bridge.sendAndWatch(bytes)
    } catch {
      await bridge.broadcast(bytes)
    }
    this.context.notifyStateChanged()
    return boc
  }

  async signTransfer(
    to: string,
    amount: string,
    comment?: string,
    expectedIdentity?: WalletIdentitySnapshot
  ): Promise<string> {
    const { message } = createTonTransferMessage(to, amount, comment)
    const { boc } = await this.context.buildBoc([message], WALLET_MAX_TIMEOUT_S, undefined, expectedIdentity)
    return boc
  }

  async send(
    to: string,
    amount: string,
    comment?: string,
    expectedIdentity?: WalletIdentitySnapshot
  ): Promise<WalletTransaction> {
    const bridge = this.context.getBridge()
    if (!bridge) throw new Error('Bridge not connected')
    const normalized = createTonTransferMessage(to, amount, comment).comment
    const boc = await this.signTransfer(to, amount, normalized, expectedIdentity)
    const bytes = Buffer.from(boc, 'base64')
    let hash: string | undefined
    let status: 'pending' | 'confirmed' = 'pending'
    try {
      hash = await bridge.sendAndWatch(bytes)
      status = 'confirmed'
    } catch {
      await bridge.broadcast(bytes)
    }
    const transaction: WalletTransaction = {
      id: crypto.randomUUID(),
      type: 'send',
      amount,
      address: to,
      timestamp: Date.now(),
      status,
      hash,
      comment: normalized,
    }
    this.context.notifyStateChanged()
    return transaction
  }

  preflightTransfer(
    to: string,
    amount: string,
    comment: string | undefined,
    expectedIdentity: WalletIdentitySnapshot
  ): Promise<TransferPreflightResult> {
    return this.context.withPreflightState(expectedIdentity, async (walletContract, seqno) => {
      const { message, bounce } = createTonTransferMessage(to, amount, comment)
      const destinationAddress = Address.parse(to).toString({ bounceable: false })
      const walletAddress = walletContract.address.toString({ bounceable: false })
      const [destination, wallet] = await Promise.all([
        this.context.getAccountInformation(destinationAddress),
        this.context.getAccountInformation(walletAddress),
      ])
      return preflightTonTransfer({
        walletContract,
        destinationBounceable: bounce,
        destinationStatus: destination.status,
        walletBalance: wallet.balance,
        message,
        seqno,
        emulateTransaction: (address, boc) => this.context.emulateTransaction(address, boc),
      })
    })
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
