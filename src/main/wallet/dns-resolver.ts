/**
 * TON DNS resolver.
 * Resolves .ton domains to wallet addresses and DNS records via WsBridgeClient.
 * Falls back to NFT owner lookup if no wallet record is set.
 */

import { createLogger } from '../../shared/logger'
import { WsBridgeClient } from './ws-bridge-client'

const log = createLogger('wallet:dns')

export interface DnsResolveResult {
  address: string
  source: 'wallet-record' | 'owner-fallback'
  domain: string
}

export async function resolveTonDomain(domain: string, bridge: WsBridgeClient): Promise<DnsResolveResult | null> {
  log.debug('Resolving domain')

  const result = await bridge.resolveDomain(domain)

  // 1. Wallet record (explicit DNS wallet record set by domain owner)
  if (result.wallet) {
    log.debug('Resolved via wallet record')
    return { address: result.wallet, source: 'wallet-record', domain }
  }

  // 2. NFT owner fallback (owner of the domain NFT)
  if (result.owner) {
    log.debug('Resolved via NFT owner fallback')
    return { address: result.owner, source: 'owner-fallback', domain }
  }

  return null
}

/**
 * Resolve a specific DNS record category for a .ton domain.
 * Returns the record value as a string, or null if not found.
 */
export async function resolveDnsRecord(
  domain: string,
  category: string,
  bridge: WsBridgeClient
): Promise<string | null> {
  const result = await bridge.resolveDomain(domain)
  if (category === 'site') {
    return result.site_adnl ?? null
  }
  if (category === 'storage') {
    return result.has_storage ? domain : null
  }
  return null
}
