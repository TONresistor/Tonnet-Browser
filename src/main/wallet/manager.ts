/**
 * Wallet manager.
 * Singleton that manages the TON W5 v5r1 wallet lifecycle.
 */

import { EventEmitter } from 'events'
import { internal, beginCell, storeMessage, Address, SendMode, Cell } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import { WalletKeyStorage } from './key-storage'
import { WsBridgeClient } from './ws-bridge-client'
import { NftIndexer } from './nft-indexer'
import { resolveTonDomain, type DnsResolveResult } from './dns-resolver'
import { getSetting } from '../settings'
import { WALLET_MAX_TIMEOUT_SECONDS } from '../../shared/constants'
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
  private wsBridge: WsBridgeClient | null = null
  private walletContract: WalletContractV5R1 | null = null
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private localSeqno: number = 0
  private unsubAccountState: (() => void) | null = null
  private unsubTransactions: (() => void) | null = null
  private nftIndexer: NftIndexer | null = null
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
    this.wsBridge = new WsBridgeClient(network.wsPort)
    await this.wsBridge.connect()

    if (await this.keyStorage.exists()) {
      try {
        this.keypair = await this.keyStorage.load()
        this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
        await this.getBalance().catch((e) => log.error('Initial balance fetch failed:', e))
        await this.syncSeqno()
        this.subscribeAccount()
        this.nftIndexer = new NftIndexer(this.wsBridge!, this.getState().address)
        this.nftIndexer.start().catch((e) => log.error('NFT indexer start failed:', e))
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
    // Ensure bridge is initialized before creating wallet
    if (!this.initialized) {
      await this.init()
    }

    const { keypair } = await this.keyStorage.generateFromMnemonic()
    this.keypair = keypair
    this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
    this.localSeqno = 0
    this.subscribeAccount()
    this.nftIndexer = new NftIndexer(this.wsBridge!, this.getState().address)
    this.nftIndexer.start().catch((e) => log.error('NFT indexer start failed:', e))

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
    if (!this.initialized) {
      await this.init()
    }
    // Unsubscribe existing account state, stop indexer, and wipe old keys
    this.unsubscribeAccount()
    if (this.nftIndexer) {
      this.nftIndexer.stop()
      this.nftIndexer = null
    }
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
    this.subscribeAccount()
    this.nftIndexer = new NftIndexer(this.wsBridge!, this.getState().address)
    this.nftIndexer.start().catch((e) => log.error('NFT indexer start failed:', e))

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
    if (!this.wsBridge || !this.walletContract) {
      return '0'
    }

    try {
      const fetched = await this.wsBridge.getBalance(this.walletContract.address.toString())
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
    if (!this.wsBridge || !this.walletContract) return []

    try {
      const rawTxs = await this.wsBridge.getTransactions(this.walletContract.address.toString(), limit)

      return rawTxs
        .map((tx: any) => {
          const inMsg = tx.in_msg
          const outMsgs: any[] = tx.out_msgs ?? []

          let type: 'send' | 'receive' = 'receive'
          let amount = '0'
          let counterparty = ''

          if (outMsgs.length > 0) {
            type = 'send'
            const msg = outMsgs[0]
            amount = msg.value ?? '0'
            counterparty = msg.destination ?? ''
          } else if (inMsg) {
            type = 'receive'
            amount = inMsg.value ?? '0'
            counterparty = inMsg.source ?? ''
          }

          if (amount === '0') return null

          return {
            id: tx.hash ?? tx.lt ?? crypto.randomUUID(),
            type,
            amount,
            address: counterparty,
            timestamp: (tx.utime ?? tx.now ?? 0) * 1000,
            status: 'confirmed' as const,
            hash: tx.hash ?? '',
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
    await this.syncSeqno()
    const boc = await this.signTransfer(to, amount)
    const bocBuffer = Buffer.from(boc, 'base64')

    let txHash: string | undefined
    let status: 'pending' | 'confirmed' = 'pending'
    try {
      txHash = await this.wsBridge!.sendAndWatch(bocBuffer)
      status = 'confirmed'
    } catch {
      // Fallback: broadcast without waiting for confirmation
      await this.wsBridge!.broadcast(bocBuffer)
    }

    const tx: WalletTransaction = {
      id: crypto.randomUUID(),
      type: 'send',
      amount,
      address: to,
      timestamp: Date.now(),
      status,
      hash: txHash,
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
    await this.syncSeqno()
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
    if (!this.wsBridge) throw new Error('Wallet not initialized')
    return resolveTonDomain(domain, this.wsBridge!)
  }

  async fetchNfts(): Promise<NftItem[]> {
    return this.nftIndexer?.getNfts() ?? []
  }

  async fetchDomains(): Promise<TonDomain[]> {
    return this.nftIndexer?.getDomains() ?? []
  }

  async lookupDomain(domain: string): Promise<DomainLookupResult> {
    if (!this.wsBridge) throw new Error('Wallet not initialized')
    const resolved = await this.wsBridge.resolveDomain(domain)

    return {
      name: domain,
      owner: resolved.owner ? Address.parse(resolved.owner).toString({ bounceable: false }) : 'unknown',
      expiresAt: resolved.expiring_at ?? 0,
      nftAddress: resolved.nft_address ? Address.parse(resolved.nft_address).toString({ bounceable: false }) : '',
      records: {
        wallet: resolved.wallet ? Address.parse(resolved.wallet).toString({ bounceable: false }) : undefined,
        site: resolved.site_adnl ?? undefined,
        storage: resolved.has_storage ? domain : undefined,
      },
    }
  }

  /**
   * Stop timers and wipe keys from memory.
   */
  destroy(): void {
    this.unsubscribeAccount()
    if (this.nftIndexer) {
      this.nftIndexer.stop()
      this.nftIndexer = null
    }
    this.keyStorage.destroy()
    if (this.keypair) {
      this.keypair.secretKey.fill(0)
      this.keypair.publicKey.fill(0)
      this.keypair = null
    }
    if (this.wsBridge) {
      this.wsBridge.disconnect()
      this.wsBridge = null
    }
    this.walletContract = null
    this.initialized = false
    log.info('Wallet manager destroyed')
  }

  private subscribeAccount(): void {
    if (!this.wsBridge || !this.walletContract) return
    const address = this.walletContract.address.toString()

    // Balance push
    this.unsubAccountState = this.wsBridge.subscribeAccountState(address, (state: any) => {
      const balance = state.balance ?? this.currentBalance
      if (balance !== this.currentBalance) {
        this.currentBalance = balance
        this.emit('balance-updated', this.currentBalance)
      }
    })

    // Transaction push
    this.unsubTransactions = this.wsBridge.subscribeTransactions(address, (tx: any) => {
      this.emit('new-transaction', tx)
    })
  }

  private unsubscribeAccount(): void {
    if (this.unsubAccountState) {
      this.unsubAccountState()
      this.unsubAccountState = null
    }
    if (this.unsubTransactions) {
      this.unsubTransactions()
      this.unsubTransactions = null
    }
  }

  private async syncSeqno(): Promise<void> {
    if (!this.wsBridge || !this.walletContract) return
    try {
      const onChainSeqno = await this.wsBridge.getSeqno(this.getState().address)
      this.localSeqno = Math.max(this.localSeqno, onChainSeqno)
    } catch (error) {
      log.error('Seqno sync failed:', error)
    }
  }
}

export const walletManager = new WalletManager()
