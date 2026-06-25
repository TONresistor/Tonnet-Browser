import { Address } from '@ton/core'
import { RateLimiter } from '../ipc/validation'
import { createLogger } from '../../shared/logger'
import type { WalletTransaction } from '../../shared/types'

const log = createLogger('wallet:indexer')
const limiter = new RateLimiter(1, 1100)

interface IndexerMessage {
  value?: string
  source?: string
  destination?: string
  message_content?: { decoded?: { comment?: string } | null } | null
}

interface IndexerTransaction {
  hash?: string
  lt?: string
  now?: number
  total_fees?: string
  in_msg?: IndexerMessage | null
  out_msgs?: IndexerMessage[] | null
}

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

function mapTransaction(tx: IndexerTransaction): WalletTransaction | null {
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
    comment = outs[0].message_content?.decoded?.comment ?? undefined
  } else if (inMsg) {
    type = 'receive'
    amount = inMsg.value ?? '0'
    counterparty = inMsg.source ?? ''
    comment = inMsg.message_content?.decoded?.comment ?? undefined
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
  address: string,
  limit: number,
  endpoint: string,
  apiKey?: string
): Promise<WalletTransaction[]> {
  if (!address) return []
  if (!limiter.check()) {
    throw new Error('Indexer rate limit reached, try again shortly')
  }

  const base = endpoint.replace(/\/+$/, '')
  const url = `${base}/transactions?account=${encodeURIComponent(address)}&limit=${limit}&sort=desc`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-Api-Key'] = apiKey

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  if (res.status === 429) {
    throw new Error('Indexer rate limited (HTTP 429) — add an API key or slow down')
  }
  if (!res.ok) {
    throw new Error(`Indexer HTTP ${res.status}`)
  }

  const data = (await res.json()) as { transactions?: IndexerTransaction[] }
  const txs = data.transactions ?? []
  log.info(`Indexer returned ${txs.length} transaction(s)`)
  return txs.map(mapTransaction).filter((tx): tx is WalletTransaction => tx !== null)
}
