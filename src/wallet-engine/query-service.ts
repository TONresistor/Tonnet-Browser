import type { DnsResolveResult, WalletTransaction } from './schemas'
const TON_DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ton$/
const RECIPIENT_CACHE_MS = 10_000
import { createLogger, type WalletLogger } from './logger'
import { decodeCommentBody } from './comment'
import { isEncryptedCommentBody } from './encrypted-comment'
import { parseMainnetAddress } from './address-utils'
import type { BridgeTransaction } from './network-types'

export interface WalletQueryBridge {
  getConnectionRevision?(): number
  getBalance(address: string): Promise<string>
  getTransactions(address: string, limit?: number, lastLt?: string, lastHash?: string): Promise<BridgeTransaction[]>
  resolveDomain(domain: string): Promise<DnsResolveResult>
}

/** Read-only wallet capabilities, independent from key storage and signing. */
export class WalletQueryService {
  private recipientCache: {
    domain: string
    address: string
    bridge: WalletQueryBridge
    revision: number
    until: number
    registrationExpiry: number | null
  } | null = null
  private recipientCacheGeneration = 0
  private recipientRequest = 0
  constructor(
    private readonly getBridge: () => WalletQueryBridge | null,
    private readonly log: WalletLogger = createLogger('wallet:queries')
  ) {}

  clearRecipientCache(): void {
    this.recipientCache = null
    this.recipientCacheGeneration++
  }

  async getBalance(address: string | null, currentBalance: string): Promise<string> {
    const bridge = this.getBridge()
    if (!bridge || !address) return currentBalance
    try {
      return await bridge.getBalance(address)
    } catch (error) {
      this.log.error('Failed to fetch balance:', error)
      return currentBalance
    }
  }

  async fetchOnChainHistory(address: string | null, limit: number): Promise<WalletTransaction[]> {
    const bridge = this.getBridge()
    if (!bridge || !address) return []

    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rawTransactions = await bridge.getTransactions(address, limit)
        return rawTransactions
          .map((transaction) => this.convertRawTransaction(transaction))
          .filter((transaction): transaction is WalletTransaction => transaction !== null)
      } catch (error) {
        lastError = error
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600))
      }
    }
    this.log.error('Failed to fetch on-chain history:', lastError)
    throw lastError
  }

  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    const bridge = this.getBridge()
    if (!bridge) throw new Error('Bridge not connected')
    return bridge.resolveDomain(domain)
  }

  async resolveRecipient(input: string): Promise<{ address: string; domain?: string }> {
    const trimmed = input.trim()
    const normalized = trimmed.toLowerCase()

    if (!(normalized.endsWith('.ton') && normalized.length <= 126)) {
      const parsed = parseMainnetAddress(trimmed)
      if (parsed.workChain === -1) throw new Error('Masterchain addresses not supported')
      return { address: trimmed }
    }

    for (let index = 0; index < normalized.length; index++) {
      if (normalized.charCodeAt(index) > 127) throw new Error('Non-ASCII domain not allowed')
    }
    if (!TON_DOMAIN_REGEX.test(normalized)) throw new Error('Invalid domain format')

    const bridge = this.getBridge()
    if (!bridge) throw new Error('Bridge not connected')
    const revision = bridge.getConnectionRevision?.() ?? 0
    const generation = this.recipientCacheGeneration
    const cached = this.recipientCache
    if (
      cached?.domain === normalized &&
      cached.bridge === bridge &&
      cached.revision === revision &&
      performance.now() < cached.until &&
      (!cached.registrationExpiry || cached.registrationExpiry >= Math.floor(Date.now() / 1000))
    )
      return { address: cached.address, domain: normalized }

    const request = ++this.recipientRequest
    let result: DnsResolveResult
    try {
      result = await bridge.resolveDomain(normalized)
    } catch (error) {
      if (error instanceof Error && error.message === 'Bridge not connected') throw error
      throw new Error('Domain not registered')
    }
    if (
      generation !== this.recipientCacheGeneration ||
      this.getBridge() !== bridge ||
      (bridge.getConnectionRevision?.() ?? 0) !== revision
    )
      throw new Error('Bridge not connected')

    if (!result.initialized) throw new Error('Domain not initialized')
    if (result.expiring_at && result.expiring_at < Math.floor(Date.now() / 1000)) {
      throw new Error('Domain expired')
    }

    const address = result.wallet || result.owner
    if (!address) throw new Error('Domain has no wallet or owner')
    const parsed = parseMainnetAddress(address)
    if (parsed.workChain === -1) throw new Error('Masterchain addresses not supported')
    if (request === this.recipientRequest)
      this.recipientCache = {
        domain: normalized,
        address,
        bridge,
        revision,
        until: performance.now() + RECIPIENT_CACHE_MS,
        registrationExpiry: result.expiring_at ?? null,
      }
    return { address, domain: normalized }
  }

  convertRawTransaction(transaction: BridgeTransaction): WalletTransaction | null {
    const inbound = transaction.in_msg
    const outbound = transaction.out_msgs ?? []
    const isSend = outbound.length > 0
    const message = isSend ? outbound[0] : inbound
    const amount = message?.value ?? '0'
    if (amount === '0') return null

    const timestamp = Number(transaction.now)
    if (!timestamp || !Number.isFinite(timestamp)) return null

    return {
      id: transaction.hash || transaction.lt || crypto.randomUUID(),
      type: isSend ? 'send' : 'receive',
      amount,
      address: isSend ? (message?.destination ?? '') : (message?.source ?? ''),
      timestamp: timestamp * 1000,
      status: 'confirmed',
      hash: transaction.hash ?? '',
      lt: transaction.lt || undefined,
      fee: transaction.total_fees,
      comment: decodeCommentBody(message?.body),
      ...(isEncryptedCommentBody(message?.body)
        ? {
            commentEncrypted: true,
            encryptedComment: { sender: message!.source, body: message!.body! },
          }
        : {}),
    }
  }
}
