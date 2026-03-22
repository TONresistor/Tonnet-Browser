/**
 * Wallet manager.
 * Singleton that manages the TON W5 v5r1 wallet lifecycle.
 */

import { EventEmitter } from 'events'
import { internal, beginCell, storeMessage, Address, SendMode, Cell } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import { WalletKeyStorage } from './key-storage'
import { TonRpcClient } from './rpc-client'
import { resolveTonDomain, type DnsResolveResult } from './dns-resolver'
import { getSetting } from '../settings'
import {
  WALLET_BALANCE_POLL_INTERVAL,
  WALLET_SEQNO_SYNC_INTERVAL,
  WALLET_MAX_TIMEOUT_SECONDS,
} from '../../shared/constants'
import type {
  WalletState,
  WalletTransaction,
  PaymentRequirements,
  ExactTonPayload,
  NftItem,
  TonDomain,
  DomainLookupResult,
} from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('wallet')

class WalletManager extends EventEmitter {
  private keyStorage: WalletKeyStorage
  private rpcClient: TonRpcClient | null = null
  private walletContract: WalletContractV5R1 | null = null
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private localSeqno: number = 0
  private balanceTimer: NodeJS.Timeout | null = null
  private seqnoTimer: NodeJS.Timeout | null = null
  private currentBalance: string = '0'
  private initialized: boolean = false

  constructor() {
    super()
    this.keyStorage = new WalletKeyStorage()
  }

  /**
   * Initialize the wallet manager. Load existing wallet or prepare for creation.
   */
  async init(): Promise<void> {
    if (this.initialized) return

    const network = getSetting('network')
    const walletSettings = getSetting('wallet')
    this.rpcClient = new TonRpcClient(network.proxyPort, walletSettings.toncenterApiKey || undefined)

    if (await this.keyStorage.exists()) {
      try {
        this.keypair = await this.keyStorage.load()
        this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
        // Stagger initial calls to avoid rate limiting on toncenter public API (1 req/s without key)
        await this.getBalance().catch((e) => log.error('Initial balance fetch failed:', e))
        await new Promise((r) => setTimeout(r, 1500))
        await this.syncSeqno()
        this.startPolling()
        log.info('Wallet loaded successfully')
      } catch (error) {
        log.error('Failed to load wallet:', error)
      }
    } else {
      log.info('No wallet found, waiting for creation')
    }

    this.initialized = true
  }

  /**
   * Create a new wallet using a 24-word mnemonic.
   */
  async create(): Promise<WalletState> {
    if (this.keypair) {
      throw new Error('Wallet already exists')
    }

    const { keypair } = await this.keyStorage.generateFromMnemonic()
    this.keypair = keypair
    this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
    this.localSeqno = 0
    this.startPolling()

    const state = this.getState()
    this.emit('state-changed', state)
    log.info('Wallet created')
    return state
  }

  /**
   * Import a wallet from a 24-word mnemonic phrase.
   * Overwrites any existing wallet.
   */
  async importWallet(mnemonic: string[]): Promise<WalletState> {
    // Stop existing polling and wipe old keys
    this.stopPolling()
    if (this.keypair) {
      this.keypair.secretKey.fill(0)
      this.keypair.publicKey.fill(0)
      this.keypair = null
    }
    this.keyStorage.destroy()

    // Delete old wallet file so importFromMnemonic can write a new one
    await this.keyStorage.deleteFile()

    this.keypair = await this.keyStorage.importFromMnemonic(mnemonic)
    this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
    this.localSeqno = 0
    this.currentBalance = '0'
    this.startPolling()

    const state = this.getState()
    this.emit('state-changed', state)
    log.info('Wallet imported from mnemonic')
    return state
  }

  /**
   * Export the mnemonic phrase for backup. Returns null for legacy seed wallets.
   */
  async exportMnemonic(): Promise<{ mnemonic: string[] }> {
    const result = await this.keyStorage.getMnemonic()
    if (!result) {
      throw new Error('This wallet was created with a raw seed and has no mnemonic phrase')
    }
    return result
  }

  /**
   * Get current wallet state.
   */
  getState(): WalletState {
    if (!this.keypair || !this.walletContract) {
      return {
        isCreated: false,
        address: '',
        addressRaw: '',
        publicKey: '',
        balance: '0',
      }
    }

    return {
      isCreated: true,
      address: this.walletContract.address.toString({ bounceable: false }),
      addressRaw: this.walletContract.address.toRawString(),
      publicKey: this.keypair.publicKey.toString('hex'),
      balance: this.currentBalance,
    }
  }

  /**
   * Fetch current balance from the network.
   */
  async getBalance(): Promise<string> {
    if (!this.rpcClient || !this.walletContract) {
      return '0'
    }

    try {
      const fetched = await this.rpcClient.getBalance(this.walletContract.address.toRawString())
      if (fetched !== this.currentBalance) {
        this.currentBalance = fetched
        this.emit('balance-updated', this.currentBalance)
      }
      return this.currentBalance
    } catch (error) {
      log.error('Failed to fetch balance:', error)
      return this.currentBalance
    }
  }

  /**
   * Fetch on-chain transaction history and convert to WalletTransaction format.
   */
  async fetchOnChainHistory(limit: number = 20): Promise<WalletTransaction[]> {
    if (!this.rpcClient || !this.walletContract) return []

    try {
      const rawTxs = await this.rpcClient.getTransactions(this.walletContract.address.toRawString(), limit)

      return rawTxs
        .map((tx: any) => {
          const inMsg = tx.inMessage
          const outMsgs = tx.outMessages ? [...tx.outMessages.values()] : []

          let type: 'send' | 'receive' = 'receive'
          let amount = '0'
          let counterparty = ''

          if (outMsgs.length > 0) {
            type = 'send'
            const msg = outMsgs[0]
            if (msg.info.type === 'internal') {
              amount = msg.info.value.coins.toString()
              counterparty = msg.info.dest?.toString({ bounceable: false }) ?? ''
            }
          } else if (inMsg && inMsg.info.type === 'internal') {
            type = 'receive'
            amount = inMsg.info.value.coins.toString()
            counterparty = inMsg.info.src?.toString({ bounceable: false }) ?? ''
          }

          if (amount === '0') return null

          return {
            id: tx.hash().toString('hex'),
            type,
            amount,
            address: counterparty,
            timestamp: tx.now * 1000,
            status: 'confirmed' as const,
            hash: tx.hash().toString('hex'),
          }
        })
        .filter(Boolean) as WalletTransaction[]
    } catch (error) {
      log.error('Failed to fetch on-chain history:', error)
      return []
    }
  }

  /**
   * Sign and broadcast a TON transfer.
   */
  async send(to: string, amount: string): Promise<WalletTransaction> {
    const boc = await this.signTransfer(to, amount)
    const bocBuffer = Buffer.from(boc, 'base64')
    await this.rpcClient!.broadcast(bocBuffer)

    const tx: WalletTransaction = {
      id: crypto.randomUUID(),
      type: 'send',
      amount,
      address: to,
      timestamp: Date.now(),
      status: 'pending',
    }

    this.emit('state-changed', this.getState())
    return tx
  }

  /**
   * Sign a transfer and return the BOC as base64.
   */
  async signTransfer(to: string, amount: string): Promise<string> {
    const { boc } = this.buildBoc(Address.parse(to), BigInt(amount), WALLET_MAX_TIMEOUT_SECONDS)
    return boc
  }

  /**
   * Sign an x402 payment and return the ExactTonPayload.
   */
  async signX402Payment(paymentReq: PaymentRequirements): Promise<ExactTonPayload> {
    if (!this.keypair || !this.walletContract) throw new Error('Wallet not initialized')
    const { boc, seqno, validUntil } = this.buildBoc(
      Address.parseRaw(paymentReq.payTo),
      BigInt(paymentReq.amount),
      paymentReq.maxTimeoutSeconds
    )
    this.emit('payment-signed', paymentReq)
    log.info(`x402 payment signed: ${paymentReq.amount} nanoTON to ${paymentReq.payTo.substring(0, 12)}...`)
    return {
      signedBoc: boc,
      walletPublicKey: this.keypair.publicKey.toString('hex'),
      walletAddress: this.walletContract.address.toRawString(),
      seqno,
      validUntil,
    }
  }

  private buildBoc(
    to: Address,
    amount: bigint,
    maxTimeout: number
  ): { boc: string; seqno: number; validUntil: number } {
    if (!this.keypair || !this.walletContract) throw new Error('Wallet not initialized')

    const seqno = this.localSeqno
    const validUntil = seqno === 0 ? 0xffffffff : Math.floor(Date.now() / 1000) + maxTimeout

    const internalMsg = internal({ to, value: amount, bounce: false })
    const transfer = this.walletContract.createTransfer({
      seqno,
      secretKey: this.keypair.secretKey,
      messages: [internalMsg],
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      timeout: validUntil,
    } as Parameters<typeof this.walletContract.createTransfer>[0]) as Cell

    const extMsg = beginCell()
      .store(
        storeMessage({
          info: { type: 'external-in', dest: this.walletContract.address, importFee: 0n },
          init: seqno === 0 ? this.walletContract.init : undefined,
          body: transfer,
        })
      )
      .endCell()

    this.localSeqno++
    return { boc: extMsg.toBoc().toString('base64'), seqno, validUntil }
  }

  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    if (!this.rpcClient) throw new Error('Wallet not initialized')
    return resolveTonDomain(domain, this.rpcClient.getClient())
  }

  private static readonly TON_DNS_COLLECTION = '0:b774d95eb20543f186c06b371ab88ad704f7e256130caf96189368a7d0cb6ccf'

  private tonapiFetch(path: string): Promise<Response> {
    const apiKey = getSetting('wallet').tonapiKey
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    return fetch(`https://tonapi.io/v2/${path}`, { headers })
  }

  async fetchNfts(): Promise<NftItem[]> {
    if (!this.walletContract) return []
    const addr = this.walletContract.address.toRawString()
    try {
      const res = await this.tonapiFetch(`accounts/${addr}/nfts?limit=100&indirect_ownership=true`)
      if (!res.ok) return []
      const data = await res.json()
      const items: any[] = data.nft_items || []
      return items
        .filter((nft: any) => nft.collection?.address !== WalletManager.TON_DNS_COLLECTION)
        .map((nft: any) => ({
          address: nft.address,
          name: nft.metadata?.name || nft.dns || 'Unknown',
          description: nft.metadata?.description,
          image: nft.previews?.find((p: any) => p.resolution === '500x500')?.url || nft.metadata?.image,
          collection: nft.collection?.name,
        }))
    } catch (err) {
      log.error('Failed to fetch NFTs:', err)
      return []
    }
  }

  async fetchDomains(): Promise<TonDomain[]> {
    if (!this.walletContract) return []
    const addr = this.walletContract.address.toRawString()
    try {
      const res = await this.tonapiFetch(
        `accounts/${addr}/nfts?collection=${WalletManager.TON_DNS_COLLECTION}&limit=100`
      )
      if (!res.ok) return []
      const data = await res.json()
      const items: any[] = data.nft_items || []
      return items.map((nft: any) => ({
        name: nft.dns || nft.metadata?.name || 'unknown.ton',
        address: nft.address,
        owner: addr,
        expiresAt: nft.metadata?.expire_at || 0,
      }))
    } catch (err) {
      log.error('Failed to fetch domains:', err)
      return []
    }
  }

  async lookupDomain(domain: string): Promise<DomainLookupResult> {
    const res = await this.tonapiFetch(`dns/${encodeURIComponent(domain)}`)
    if (!res.ok) throw new Error(`Domain not found: ${domain}`)
    const data = await res.json()

    const records: DomainLookupResult['records'] = {}
    try {
      const resolveRes = await this.tonapiFetch(`dns/${encodeURIComponent(domain)}/resolve`)
      if (resolveRes.ok) {
        const r = await resolveRes.json()
        if (r.wallet?.address) {
          records.wallet = Address.parseRaw(r.wallet.address).toString({ bounceable: false })
        }
        if (r.sites?.length > 0) {
          records.site = r.sites[0]
        }
        if (r.storage) {
          records.storage = r.storage
        }
        if (r.next_resolver) {
          records.nextResolver =
            typeof r.next_resolver === 'string'
              ? r.next_resolver
              : r.next_resolver.address
                ? Address.parseRaw(r.next_resolver.address).toString({ bounceable: false })
                : undefined
        }
      }
    } catch {
      /* resolve failed */
    }

    // Try on-chain for site ADNL record if TonAPI didn't return it
    if (!records.site && this.rpcClient) {
      try {
        const { resolveDnsRecord } = await import('./dns-resolver')
        const siteAddr = await resolveDnsRecord(domain, 'site', this.rpcClient.getClient())
        if (siteAddr) records.site = siteAddr
      } catch {
        /* on-chain site lookup failed */
      }
    }

    const nftAddr = data.item?.address || ''

    return {
      name: data.name || domain,
      owner: data.item?.owner?.address
        ? Address.parseRaw(data.item.owner.address).toString({ bounceable: false })
        : 'unknown',
      expiresAt: data.expiring_at || 0,
      nftAddress: nftAddr ? Address.parseRaw(nftAddr).toString({ bounceable: false }) : '',
      records,
    }
  }

  /**
   * Stop timers and wipe keys from memory.
   */
  destroy(): void {
    this.stopPolling()
    this.keyStorage.destroy()
    if (this.keypair) {
      this.keypair.secretKey.fill(0)
      this.keypair.publicKey.fill(0)
      this.keypair = null
    }
    this.walletContract = null
    this.initialized = false
    log.info('Wallet manager destroyed')
  }

  private stopPolling(): void {
    if (this.balanceTimer) {
      clearInterval(this.balanceTimer)
      this.balanceTimer = null
    }
    if (this.seqnoTimer) {
      clearInterval(this.seqnoTimer)
      this.seqnoTimer = null
    }
  }

  private startPolling(): void {
    this.balanceTimer = setInterval(() => {
      this.getBalance().catch((e) => log.error('Balance poll failed:', e))
    }, WALLET_BALANCE_POLL_INTERVAL)

    this.seqnoTimer = setInterval(() => {
      this.syncSeqno().catch((e) => log.error('Seqno sync failed:', e))
    }, WALLET_SEQNO_SYNC_INTERVAL)
  }

  private async syncSeqno(): Promise<void> {
    if (!this.rpcClient || !this.keypair) return
    try {
      const onChainSeqno = await this.rpcClient.getSeqno(this.keypair.publicKey)
      // FIX 9: Use Math.max to avoid rolling back a locally-incremented seqno
      this.localSeqno = Math.max(this.localSeqno, onChainSeqno)
    } catch (error) {
      log.error('Seqno sync failed:', error)
    }
  }
}

export const walletManager = new WalletManager()
