import { beginCell, SendMode, storeMessage, type Cell, type MessageRelaxed } from '@ton/core'
import type { WalletContractShape } from './wallet-versions'

export function buildExternalWalletBoc(options: {
  walletContract: WalletContractShape
  secretKey: Buffer
  messages: MessageRelaxed[]
  seqno: number
  maxTimeout: number
  nowSeconds?: number
}): { boc: string; seqno: number; validUntil: number } {
  const { walletContract, secretKey, messages, seqno, maxTimeout, nowSeconds = Math.floor(Date.now() / 1000) } = options
  const validUntil = seqno === 0 ? 0xffffffff : nowSeconds + maxTimeout
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
