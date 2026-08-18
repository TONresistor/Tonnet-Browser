import { beginCell, SendMode, storeMessage, type Cell, type MessageRelaxed } from '@ton/core'
import type { WalletContractV5R1 } from '@ton/ton'

export function buildExternalWalletBoc(options: {
  walletContract: WalletContractV5R1
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
  } as Parameters<typeof walletContract.createTransfer>[0]) as Cell
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
