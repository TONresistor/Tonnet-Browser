import { beginCell, SendMode, storeMessage, type Cell, type MessageRelaxed } from '@ton/core'
import type { WalletContractShape } from './wallet-versions'
import { WalletContractV5R1 } from '@ton/ton'

export function buildExternalWalletBoc(options: {
  walletContract: WalletContractShape
  secretKey: Buffer
  messages: MessageRelaxed[]
  seqno: number
  maxTimeout: number
  validUntil?: number
  nowSeconds?: number
}): { boc: string; seqno: number; validUntil: number } {
  const { walletContract, secretKey, messages, seqno, maxTimeout, nowSeconds = Math.floor(Date.now() / 1000) } = options
  const validUntil = options.validUntil ?? nowSeconds + maxTimeout
  const transfer = walletContract.createTransfer({
    seqno,
    secretKey,
    messages,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    timeout: validUntil,
  }) as Cell
  const externalMessage = beginCell()
    .store(
      storeMessage({
        info: { type: 'external-in', dest: walletContract.address, importFee: 0n },
        init: seqno === 0 ? walletContract.init : undefined,
        body: transfer,
      })
    )
    .endCell()
  return { boc: externalMessage.toBoc().toString('base64'), seqno, validUntil }
}

export function buildInternalWalletBoc(options: {
  walletContract: WalletContractShape
  secretKey: Buffer
  messages: MessageRelaxed[]
  seqno: number
  validUntil: number
}): { boc: string; seqno: number; validUntil: number } {
  const { walletContract, secretKey, messages, seqno, validUntil } = options
  if (!(walletContract instanceof WalletContractV5R1)) throw new Error('signMessage requires a V5R1 wallet')
  const body = walletContract.createTransfer({
    seqno,
    secretKey,
    messages,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    timeout: validUntil,
    authType: 'internal',
  })
  return { boc: body.toBoc().toString('base64'), seqno, validUntil }
}
