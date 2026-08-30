import { z } from 'zod'
import { isAllowedTonIndexerEndpoint } from '../../shared/schemas'

const DEFAULT_TIMEOUT_MS = 15_000
const ANONYMOUS_REQUEST_INTERVAL_MS = 1_100
const MAX_RATE_LIMIT_RETRIES = 2

const DecimalStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/)

const TonIndexerMessageContentSchema = z
  .object({
    body: z.string().nullable().optional(),
    decoded: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough()

export const TonIndexerMessageSchema = z
  .object({
    source: z.string().nullable().optional(),
    destination: z.string().nullable().optional(),
    value: DecimalStringSchema.optional(),
    created_lt: DecimalStringSchema.optional(),
    message_content: TonIndexerMessageContentSchema.nullable().optional(),
  })
  .passthrough()

export const TonIndexerTransactionSchema = z
  .object({
    hash: z.string().min(1),
    lt: DecimalStringSchema,
    now: z.number().int().nonnegative(),
    total_fees: DecimalStringSchema.optional(),
    block_ref: z
      .object({
        seqno: z.number().int().nonnegative(),
      })
      .passthrough(),
    description: z
      .object({
        aborted: z.boolean(),
      })
      .passthrough(),
    in_msg: TonIndexerMessageSchema.nullable().optional(),
    out_msgs: z.array(TonIndexerMessageSchema).default([]),
  })
  .passthrough()

export const TonIndexerNftItemSchema = z
  .object({
    content: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough()

const TransactionsResponseSchema = z
  .object({
    transactions: z.array(TonIndexerTransactionSchema).default([]),
  })
  .passthrough()

const NftItemsResponseSchema = z
  .object({
    nft_items: z.array(TonIndexerNftItemSchema).default([]),
  })
  .passthrough()

export type TonIndexerMessage = z.infer<typeof TonIndexerMessageSchema>
export type TonIndexerTransaction = z.infer<typeof TonIndexerTransactionSchema>
export type TonIndexerNftItem = z.infer<typeof TonIndexerNftItemSchema>

export interface TonIndexerConfig {
  enabled: boolean
  endpoint: string
  apiKey?: string
}

interface TonIndexerClientDependencies {
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
}

interface TransactionsQuery {
  account: string
  limit: number
  sort?: 'asc' | 'desc'
  beforeLt?: string
}

interface NftItemsQuery {
  ownerAddress: string
  collectionAddress: string
  limit: number
}

export class TonIndexerDisabledError extends Error {
  constructor() {
    super('HTTP indexer fallback is disabled')
    this.name = 'TonIndexerDisabledError'
  }
}

export class TonIndexerClient {
  private readonly fetchFn: NonNullable<TonIndexerClientDependencies['fetch']>
  private readonly sleep: NonNullable<TonIndexerClientDependencies['sleep']>
  private readonly now: NonNullable<TonIndexerClientDependencies['now']>
  private requestChain: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(
    private readonly config: () => TonIndexerConfig,
    dependencies: TonIndexerClientDependencies = {}
  ) {
    this.fetchFn = dependencies.fetch ?? globalThis.fetch
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.now = dependencies.now ?? Date.now
  }

  isEnabled(): boolean {
    return this.config().enabled
  }

  async getTransactions(query: TransactionsQuery): Promise<TonIndexerTransaction[]> {
    assertLimit(query.limit)
    if (!query.account) throw new TypeError('Indexer transaction account is required')
    if (query.beforeLt !== undefined && !DecimalStringSchema.safeParse(query.beforeLt).success) {
      throw new TypeError('Indexer transaction cursor is invalid')
    }
    if (query.beforeLt === '0') return []

    const parameters: Record<string, string | number> = {
      account: query.account,
      limit: query.limit,
      sort: query.sort ?? 'desc',
    }
    if (query.beforeLt !== undefined) parameters.end_lt = (BigInt(query.beforeLt) - 1n).toString()

    const response = await this.get('/transactions', parameters)
    return TransactionsResponseSchema.parse(response).transactions
  }

  async getNftItems(query: NftItemsQuery): Promise<TonIndexerNftItem[]> {
    assertLimit(query.limit)
    if (!query.ownerAddress || !query.collectionAddress) throw new TypeError('Indexer NFT query is incomplete')
    const response = await this.get('/nft/items', {
      owner_address: query.ownerAddress,
      collection_address: query.collectionAddress,
      limit: query.limit,
    })
    return NftItemsResponseSchema.parse(response).nft_items
  }

  private get(pathname: string, parameters: Record<string, string | number>): Promise<unknown> {
    const current = this.config()
    if (!current.enabled) throw new TonIndexerDisabledError()
    const config = normalizeConfig(current)
    const interval = config.apiKey ? 0 : ANONYMOUS_REQUEST_INTERVAL_MS
    return this.enqueue(interval, () => this.request(config, pathname, parameters, interval))
  }

  private enqueue<T>(interval: number, operation: () => Promise<T>): Promise<T> {
    const result = this.requestChain
      .catch(() => undefined)
      .then(async () => {
        const wait = Math.max(0, this.lastRequestAt + interval - this.now())
        if (wait > 0) await this.sleep(wait)
        this.lastRequestAt = this.now()
        return operation()
      })
    this.requestChain = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async request(
    config: NormalizedTonIndexerConfig,
    pathname: string,
    parameters: Record<string, string | number>,
    interval: number
  ): Promise<unknown> {
    const url = buildUrl(config.endpoint, pathname, parameters)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (config.apiKey) headers['X-Api-Key'] = config.apiKey

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      const response = await this.fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })
      if (response.status !== 429) {
        if (!response.ok) throw new Error(`Indexer HTTP ${response.status}`)
        return response.json()
      }
      if (attempt === MAX_RATE_LIMIT_RETRIES) {
        throw new Error('Indexer rate limited (HTTP 429)')
      }
      await this.sleep(retryDelay(response.headers.get('retry-after'), interval, attempt))
    }
    throw new Error('Indexer request failed')
  }
}

interface NormalizedTonIndexerConfig {
  enabled: boolean
  endpoint: URL
  apiKey?: string
}

function normalizeConfig(config: TonIndexerConfig): NormalizedTonIndexerConfig {
  let endpoint: URL
  try {
    endpoint = new URL(config.endpoint)
  } catch {
    throw new TypeError('Indexer endpoint is invalid')
  }
  if (!isAllowedTonIndexerEndpoint(endpoint)) {
    throw new TypeError('Remote indexer endpoints must use HTTPS')
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError('Indexer endpoint must be a plain API base URL')
  }
  const apiKey = config.apiKey?.trim()
  return { enabled: config.enabled, endpoint, ...(apiKey ? { apiKey } : {}) }
}

function buildUrl(endpoint: URL, pathname: string, parameters: Record<string, string | number>): URL {
  const url = new URL(endpoint.toString())
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value))
  return url
}

function retryDelay(retryAfter: string | null, interval: number, attempt: number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
    const at = Date.parse(retryAfter)
    if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  }
  return Math.max(interval, 1_000 * 2 ** attempt)
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError('Indexer limit must be between 1 and 1000')
  }
}
