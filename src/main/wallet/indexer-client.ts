import { Address } from '@ton/core'
import { createLogger } from '../../shared/logger'
import type { WalletTransaction } from '../../shared/types'
import type { TonIndexerClient, TonIndexerMessage, TonIndexerTransaction } from '../indexer/client'

const log = createLogger('wallet:indexer')

function toFriendly(raw?: string): string {
  if (!raw) return ''
  try {
    return Address.parse(raw).toString({ bounceable: true, urlSafe: true })
  } catch {
    return raw
  }
}

function toHexHash(hash?: string): string {
  if (!hash) return ''
  if (/^[0-9a-fA-F]{64}$/.test(hash)) return hash.toLowerCase()
  try {
    return Buffer.from(hash, 'base64').toString('hex')
  } catch {
    return hash
  }
}

function messageComment(message: TonIndexerMessage | null | undefined): string | undefined {
  const comment = message?.message_content?.decoded?.comment
  return typeof comment === 'string' && comment ? comment : undefined
}

function mapTransaction(tx: TonIndexerTransaction): WalletTransaction | null {
  const outs = tx.out_msgs ?? []
  const inMsg = tx.in_msg

  let type: 'send' | 'receive' = 'receive'
  let amount = '0'
  let counterparty = ''
  let comment: string | undefined

  if (outs.length > 0) {
    type = 'send'
    amount = outs[0].value ?? '0'
    counterparty = outs[0].destination ?? ''
    comment = messageComment(outs[0])
  } else if (inMsg) {
    type = 'receive'
    amount = inMsg.value ?? '0'
    counterparty = inMsg.source ?? ''
    comment = messageComment(inMsg)
  }

  if (amount === '0') return null

  const rawTime = Number(tx.now)
  if (!rawTime || !Number.isFinite(rawTime)) return null

  const hash = toHexHash(tx.hash)
  return {
    id: hash || tx.lt || '',
    type,
    amount,
    address: toFriendly(counterparty),
    timestamp: rawTime * 1000,
    status: 'confirmed',
    hash,
    lt: tx.lt || undefined,
    fee: tx.total_fees,
    comment: comment || undefined,
  }
}

export async function fetchHistoryViaIndexer(
  indexer: TonIndexerClient,
  address: string,
  limit: number
): Promise<WalletTransaction[]> {
  if (!address) return []
  const txs = await indexer.getTransactions({ account: address, limit, sort: 'desc' })
  log.info(`Indexer returned ${txs.length} transaction(s)`)
  return txs.map(mapTransaction).filter((tx): tx is WalletTransaction => tx !== null)
}
