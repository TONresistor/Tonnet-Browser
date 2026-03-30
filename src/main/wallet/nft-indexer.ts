/**
 * NFT Indexer.
 * Discovers wallet NFTs by scanning on-chain transactions for
 * ownership_assigned / nft_transfer opcodes, then enriches via bridge.getNftData().
 */

import { Cell, Address } from '@ton/core'
import { SafeStorageWrapper } from '../history/safe-storage-wrapper'
import { WsBridgeClient } from './ws-bridge-client'
import { createLogger } from '../../shared/logger'
import type { NftItem, TonDomain } from '../../shared/types'

const log = createLogger('wallet:nft-indexer')
const TON_DNS_COLLECTION = 'EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz'
const OP_OWNERSHIP_ASSIGNED = 0x05138d91
const OP_NFT_TRANSFER = 0x5fcc3d14
const PAGE_SIZE = 100
const MAX_PAGES = 5

interface IndexedNft {
  address: string
  name: string
  description?: string
  image?: string
  collectionAddress?: string
}

interface NftCache {
  lastScannedLt: string
  nfts: IndexedNft[]
}

function getOpcode(bodyBase64: string): number | null {
  try {
    if (!bodyBase64) return null
    const buf = Buffer.from(bodyBase64, 'base64')
    const cell = Cell.fromBoc(buf)[0]
    const slice = cell.beginParse()
    if (slice.remainingBits < 32) return null
    return slice.loadUint(32)
  } catch {
    return null
  }
}

function addressEquals(a: string, b: string): boolean {
  try {
    return Address.parse(a).equals(Address.parse(b))
  } catch {
    return a === b
  }
}

function toKey(addr: string): string {
  try {
    return Address.parse(addr).toRawString()
  } catch {
    return addr
  }
}

export class NftIndexer {
  private bridge: WsBridgeClient
  private walletAddress: string
  private storage: SafeStorageWrapper
  private nfts = new Map<string, IndexedNft>()
  private lastScannedLt: string = '0'
  private unsubscribe: (() => void) | null = null

  constructor(bridge: WsBridgeClient, walletAddress: string) {
    this.bridge = bridge
    this.walletAddress = walletAddress
    this.storage = new SafeStorageWrapper('nft-cache')
  }

  async start(): Promise<void> {
    const cached = await this.storage.read<NftCache>()
    if (cached) {
      this.lastScannedLt = cached.lastScannedLt
      for (const nft of cached.nfts) {
        this.nfts.set(toKey(nft.address), nft)
      }
      log.info(`Loaded ${cached.nfts.length} NFTs from cache`)
    }

    await this.scan()

    this.unsubscribe = this.bridge.subscribeTransactions(this.walletAddress, (tx: any) => {
      this.processTransaction(tx)
        .then(() => this.saveCache())
        .catch((e) => log.error('Failed to process live tx:', e))
    })
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  getNfts(): NftItem[] {
    const result: NftItem[] = []
    for (const nft of this.nfts.values()) {
      if (nft.collectionAddress && addressEquals(nft.collectionAddress, TON_DNS_COLLECTION)) continue
      result.push({
        address: nft.address,
        name: nft.name,
        description: nft.description,
        image: nft.image,
        collection: nft.collectionAddress,
      })
    }
    return result
  }

  getDomains(): TonDomain[] {
    const result: TonDomain[] = []
    for (const nft of this.nfts.values()) {
      if (!nft.collectionAddress || !addressEquals(nft.collectionAddress, TON_DNS_COLLECTION)) continue
      result.push({
        name: nft.name || 'unknown.ton',
        address: nft.address,
        owner: this.walletAddress,
        expiresAt: 0,
      })
    }
    return result
  }

  private async scan(): Promise<void> {
    const previousLt = this.lastScannedLt
    let lastLt: string | undefined
    let lastHash: string | undefined
    let totalScanned = 0

    for (let page = 0; page < MAX_PAGES; page++) {
      const txs = await this.bridge.getTransactions(this.walletAddress, PAGE_SIZE, lastLt, lastHash)
      if (txs.length === 0) break

      if (page === 0 && txs[0]?.lt) {
        this.lastScannedLt = txs[0].lt
      }

      let reachedPrevious = false
      for (const tx of txs) {
        if (previousLt !== '0' && tx.lt && BigInt(tx.lt) <= BigInt(previousLt)) {
          reachedPrevious = true
          break
        }
        await this.processTransaction(tx)
        totalScanned++
      }

      if (reachedPrevious) break

      const lastTx = txs[txs.length - 1]
      if (lastTx.prev_tx_lt && lastTx.prev_tx_lt !== '0') {
        lastLt = lastTx.prev_tx_lt
        lastHash = lastTx.prev_tx_hash
      } else {
        break
      }
    }

    log.info(`Scanned ${totalScanned} transactions, indexed ${this.nfts.size} NFTs`)
    await this.saveCache()
  }

  private async processTransaction(tx: any): Promise<void> {
    if (tx.in_msg?.body) {
      const opcode = getOpcode(tx.in_msg.body)
      if (opcode === OP_OWNERSHIP_ASSIGNED && tx.in_msg.source) {
        await this.enrichAndAdd(tx.in_msg.source)
      }
    }

    const outMsgs: any[] = tx.out_msgs ?? []
    for (const msg of outMsgs) {
      if (msg.body) {
        const opcode = getOpcode(msg.body)
        if (opcode === OP_NFT_TRANSFER && msg.destination) {
          this.nfts.delete(toKey(msg.destination))
        }
      }
    }
  }

  private async enrichAndAdd(nftAddress: string): Promise<void> {
    try {
      const data = await this.bridge.getNftData(nftAddress)
      if (data.owner && !addressEquals(data.owner, this.walletAddress)) return

      this.nfts.set(toKey(nftAddress), {
        address: Address.parse(nftAddress).toString({ bounceable: true }),
        name: data.content?.name || 'Unknown',
        description: data.content?.description,
        image: data.content?.image,
        collectionAddress: data.collection,
      })
    } catch (e) {
      log.error(`Failed to fetch NFT data for ${nftAddress}:`, e)
    }
  }

  private async saveCache(): Promise<void> {
    await this.storage.write<NftCache>({
      lastScannedLt: this.lastScannedLt,
      nfts: Array.from(this.nfts.values()),
    })
  }
}
