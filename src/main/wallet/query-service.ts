import type { DnsResolveResult, WalletTransaction } from '../../shared/types'
import { TON_DOMAIN_REGEX } from '../../shared/utils/ton'
import { createLogger } from '../../shared/logger'
import { decodeCommentBody } from './comment'
import { parseMainnetAddress } from './address-utils'
import type { BridgeTransaction } from '../ports/ton-bridge'

const log = createLogger('wallet:queries')

export interface WalletQueryBridge {
  getBalance(address: string): Promise<string>
  getTransactions(address: string, limit?: number, lastLt?: string, lastHash?: string): Promise<BridgeTransaction[]>
  resolveDomain(domain: string): Promise<DnsResolveResult>
}

/** Read-only wallet capabilities, independent from key storage and signing. */
export class WalletQueryService {
  constructor(private readonly getBridge: () => WalletQueryBridge | null) {}

  async getBalance(address: string | null, currentBalance: string): Promise<string> {
    const bridge = this.getBridge()
    if (!bridge || !address) return currentBalance
    try {
      return await bridge.getBalance(address)
    } catch (error) {
      log.error('Failed to fetch balance:', error)
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
    log.error('Failed to fetch on-chain history:', lastError)
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

    let result: DnsResolveResult
    try {
      result = await this.resolveDomain(normalized)
    } catch (error) {
      if (error instanceof Error && error.message === 'Bridge not connected') throw error
      throw new Error('Domain not registered')
    }

    if (!result.initialized) throw new Error('Domain not initialized')
    if (result.expiring_at && result.expiring_at < Math.floor(Date.now() / 1000)) {
      throw new Error('Domain expired')
    }

    const address = result.wallet || result.owner
    if (!address) throw new Error('Domain has no wallet or owner')
    const parsed = parseMainnetAddress(address)
    if (parsed.workChain === -1) throw new Error('Masterchain addresses not supported')
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
    }
  }
}
