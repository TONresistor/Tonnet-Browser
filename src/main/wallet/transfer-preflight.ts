import type { MessageRelaxed } from '@ton/core'
import type { EmulateTransactionResult } from '../ton-bridge/bridge-codecs'
import { buildExternalWalletBoc } from './wallet-boc'
import type { WalletContractShape } from './wallet-versions'

export interface TransferPreflightResult {
  estimatedFee: string
  destinationStatus: string
  walletBalance: string
}

export async function preflightTonTransfer(options: {
  walletContract: WalletContractShape
  destinationBounceable: boolean
  destinationStatus: string
  walletBalance: string
  message: MessageRelaxed
  seqno: number
  emulateTransaction(address: string, boc: string): Promise<EmulateTransactionResult>
}): Promise<TransferPreflightResult> {
  if (options.destinationBounceable && options.destinationStatus !== 'active') {
    throw new Error('Bounceable recipient is not an active contract')
  }

  const secretKey = Buffer.alloc(64)
  let boc: string
  try {
    boc = buildExternalWalletBoc({
      walletContract: options.walletContract,
      secretKey,
      messages: [options.message],
      seqno: options.seqno,
      maxTimeout: 300,
    }).boc
  } finally {
    secretKey.fill(0)
  }

  const emulation = await options.emulateTransaction(
    options.walletContract.address.toString({ bounceable: false }),
    boc
  )
  if (!emulation.accepted || !emulation.success) {
    throw new Error(`Transaction emulation rejected (exit code ${emulation.exit_code})`)
  }
  const rawFee = BigInt(emulation.total_fees)
  if (rawFee <= 0n) throw new Error('Transaction emulator returned an invalid zero fee')
  const estimatedFee = (rawFee * 105n + 99n) / 100n
  return {
    estimatedFee: estimatedFee.toString(),
    destinationStatus: options.destinationStatus,
    walletBalance: options.walletBalance,
  }
}
