/**
 * TON DNS resolver.
 * Resolves .ton domains to wallet addresses via on-chain DNS records,
 * NFT owner fallback, or TonAPI REST fallback.
 */

import { Address, beginCell, Cell } from '@ton/core'
import { TonClient } from '@ton/ton'
import { createHash } from 'crypto'
import { createLogger } from '../../shared/logger'
import { withRetry } from './rpc-client'

const log = createLogger('wallet:dns')

const ROOT_DNS_ADDRESS = Address.parse('-1:e56754f83426f69b09267bd876ac97c44821345b7e266bd956a7bfbfb98df35c')
const WALLET_CATEGORY = BigInt('0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b')
const DNS_NEXT_RESOLVER_MAGIC = 0xba93
const DNS_SMC_ADDRESS_MAGIC = 0x9fd3
const MAX_RECURSION = 4

export interface DnsResolveResult {
  address: string
  source: 'wallet-record' | 'owner-fallback'
  domain: string
}

function encodeDomainToCell(domain: string): Cell {
  const parts = domain.toLowerCase().split('.').reverse()
  const buffers: Buffer[] = []
  for (const part of parts) {
    buffers.push(Buffer.from(part, 'utf-8'))
    buffers.push(Buffer.from([0]))
  }
  const joined = Buffer.concat(buffers)
  const withPrefix = joined.length < 126 ? Buffer.concat([Buffer.from([0]), joined]) : joined
  return beginCell().storeBuffer(withPrefix).endCell()
}

interface OnChainResult {
  walletAddress?: string
  nftItemAddress?: Address
}

async function resolveOnChain(
  client: TonClient,
  contractAddr: Address,
  domainCell: Cell,
  depth: number
): Promise<OnChainResult> {
  if (depth > MAX_RECURSION) return {}

  let result
  try {
    result = await withRetry(async () => {
      return client.runMethod(contractAddr, 'dnsresolve', [
        { type: 'slice', cell: domainCell },
        { type: 'int', value: WALLET_CATEGORY },
      ])
    }, 'dnsresolve')
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (msg.includes('-13') || msg.includes('-256') || msg.includes('Unable to execute')) {
      return {}
    }
    throw err
  }

  const resolvedBits = result.stack.readNumber()
  const resultCell = result.stack.readCellOpt()

  if (!resultCell) {
    // No wallet record at this resolver. If this is NOT the root (depth > 0),
    // the current contractAddr is the NFT item itself.
    if (depth > 0) return { nftItemAddress: contractAddr }
    return {}
  }

  const slice = resultCell.beginParse()
  const magic = slice.loadUint(16)

  if (magic === DNS_SMC_ADDRESS_MAGIC) {
    const addr = slice.loadAddress()
    return { walletAddress: addr.toString({ bounceable: false }) }
  }

  if (magic === DNS_NEXT_RESOLVER_MAGIC) {
    const nextResolver = slice.loadAddress()
    const totalBits = domainCell.bits.length
    if (resolvedBits >= totalBits) {
      // Fully resolved but got next_resolver: re-query with empty domain
      const emptyCell = beginCell().storeUint(0, 8).endCell()
      return resolveOnChain(client, nextResolver, emptyCell, depth + 1)
    }
    const remaining = domainCell.beginParse()
    remaining.skip(resolvedBits)
    const remainingCell = beginCell().storeSlice(remaining).endCell()
    return resolveOnChain(client, nextResolver, remainingCell, depth + 1)
  }

  return {}
}

async function getNftOwner(client: TonClient, nftAddress: Address): Promise<string | null> {
  try {
    const dataResult = await withRetry(async () => {
      return client.runMethod(nftAddress, 'get_nft_data', [])
    }, 'get_nft_data')

    dataResult.stack.readNumber() // init
    dataResult.stack.readBigNumber() // index
    dataResult.stack.readAddress() // collection
    const owner = dataResult.stack.readAddress()
    return owner.toString({ bounceable: false })
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (msg.includes('-13') || msg.includes('-256') || msg.includes('Unable to execute')) {
      return null
    }
    throw err
  }
}

async function resolveTonApiFallback(domain: string): Promise<DnsResolveResult | null> {
  try {
    const res = await fetch(`https://tonapi.io/v2/dns/${domain}/resolve`)
    if (res.ok) {
      const data = await res.json()
      if (data.wallet?.address) {
        const addr = Address.parseRaw(data.wallet.address)
        log.debug('Resolved via TonAPI wallet record')
        return { address: addr.toString({ bounceable: false }), source: 'wallet-record', domain }
      }
    }
  } catch {
    // fall through
  }

  try {
    const res = await fetch(`https://tonapi.io/v2/dns/${domain}`)
    if (res.ok) {
      const data = await res.json()
      const ownerRaw = data.item?.owner?.address
      if (ownerRaw) {
        const addr = Address.parseRaw(ownerRaw)
        log.debug('Resolved via TonAPI NFT owner')
        return { address: addr.toString({ bounceable: false }), source: 'owner-fallback', domain }
      }
    }
  } catch {
    // exhausted
  }

  return null
}

export async function resolveTonDomain(domain: string, client: TonClient): Promise<DnsResolveResult> {
  log.debug('Resolving domain')

  try {
    const domainCell = encodeDomainToCell(domain)
    const { walletAddress, nftItemAddress } = await resolveOnChain(client, ROOT_DNS_ADDRESS, domainCell, 0)

    if (walletAddress) {
      log.debug('Resolved via on-chain wallet record')
      return { address: walletAddress, source: 'wallet-record', domain }
    }

    if (nftItemAddress) {
      const owner = await getNftOwner(client, nftItemAddress)
      if (owner) {
        log.debug('Resolved via on-chain NFT owner fallback')
        return { address: owner, source: 'owner-fallback', domain }
      }
    }
  } catch (err) {
    log.debug('On-chain resolution failed, trying TonAPI fallback:', err)
  }

  const apiResult = await resolveTonApiFallback(domain)
  if (apiResult) return apiResult

  throw new Error(`Could not resolve ${domain}`)
}

/**
 * Resolve a specific DNS record category for a .ton domain.
 * Returns the address as friendly string, or null if not found.
 */
export async function resolveDnsRecord(domain: string, category: string, client: TonClient): Promise<string | null> {
  const categoryHash = BigInt('0x' + createHash('sha256').update(category).digest('hex'))
  const domainCell = encodeDomainToCell(domain)

  let currentResolver = ROOT_DNS_ADDRESS
  let currentCell = domainCell

  for (let depth = 0; depth < MAX_RECURSION; depth++) {
    let result
    try {
      result = await withRetry(async () => {
        return client.runMethod(currentResolver, 'dnsresolve', [
          { type: 'slice', cell: currentCell },
          { type: 'int', value: categoryHash },
        ])
      }, 'dnsresolve')
    } catch {
      return null
    }

    const resolvedBits = result.stack.readNumber()
    const resultCell = result.stack.readCellOpt()
    if (!resultCell) return null

    const slice = resultCell.beginParse()
    const magic = slice.loadUint(16)

    if (magic === DNS_SMC_ADDRESS_MAGIC) {
      const addr = slice.loadAddress()
      return addr.toString({ bounceable: false })
    }

    if (magic === DNS_NEXT_RESOLVER_MAGIC) {
      currentResolver = slice.loadAddress()
      const totalBits = currentCell.bits.length
      if (resolvedBits >= totalBits) {
        currentCell = beginCell().storeUint(0, 8).endCell()
      } else {
        const remaining = currentCell.beginParse()
        remaining.skip(resolvedBits)
        currentCell = beginCell().storeSlice(remaining).endCell()
      }
      continue
    }

    // ADNL address record (0xad01) - return hex
    if (magic === 0xad01) {
      const adnl = slice.loadBuffer(32)
      return adnl.toString('hex')
    }

    return null
  }
  return null
}
