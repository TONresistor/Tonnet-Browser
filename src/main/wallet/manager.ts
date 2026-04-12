/**
 * Wallet manager.
 * Singleton that manages the TON W5 v5r1 wallet lifecycle.
 */

import { EventEmitter } from 'events'
import { internal, beginCell, storeMessage, Address, SendMode, Cell } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import { WalletKeyStorage, WalletDecryptionError } from './key-storage'
import type { ISecureStorage } from '../ports/secure-storage'
import { WsBridgeClient, type BridgeTransaction, type BridgeAccountState } from './ws-bridge-client'
import { getSetting } from '../settings'
import { WALLET_MAX_TIMEOUT_S, WALLET_HISTORY_DEFAULT_LIMIT } from './constants'
import type {
  WalletState,
  WalletTransaction,
  PaymentRequirements,
  ExactTonPayload,
  DnsResolveResult,
} from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('wallet')

const TON_DOMAIN_REGEX = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ton$/

function isTonDomain(s: string): boolean {
  return s.endsWith('.ton') && s.length <= 126
}

export class WalletManager extends EventEmitter {
  private keyStorage: WalletKeyStorage
  private wsBridge: WsBridgeClient | null = null
  private walletContract: WalletContractV5R1 | null = null
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private publicKey: Buffer | null = null
  private localSeqno: number = 0
  private unsubAccountState: (() => void) | null = null
  private unsubTransactions: (() => void) | null = null
  private currentBalance: string = '0'
  private initialized: boolean = false
  private decryptFailed: boolean = false
  private weakEncryption: boolean = false
  private signLock: Promise<void> = Promise.resolve()

  constructor(secureStorage?: ISecureStorage) {
    super()
    this.keyStorage = secureStorage ? new WalletKeyStorage(secureStorage) : new WalletKeyStorage()
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
        this.publicKey = Buffer.from(this.keypair.publicKey)
        this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
        await this.warmupLiteserverPool()
        await this.syncSeqno()
        this.subscribeAccount()
        const walletSettings = getSetting('wallet')
        this.keyStorage.setAutoLockMinutes(walletSettings.autoLockMinutes)
        if (this.keyStorage.isBasicTextBackend()) {
          this.weakEncryption = true
        }
        log.info('Wallet loaded successfully')
      } catch (error) {
        if (error instanceof WalletDecryptionError) {
          log.error('Wallet decryption failed (keyring backend may have changed):', error)
          this.decryptFailed = true
          this.emit('state-changed', this.getState())
        } else {
          log.error('Failed to load wallet:', error)
        }
      }
    } else {
      log.info('No wallet found, waiting for creation')
    }

    this.initialized = true
    this.emit('state-changed', this.getState())
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

    // If previous wallet could not be decrypted, remove the stale file first
    if (this.decryptFailed) {
      await this.keyStorage.deleteFile()
      this.decryptFailed = false
    }

    const { keypair, mnemonic } = await this.keyStorage.generateFromMnemonic()
    this.keypair = keypair
    this.publicKey = Buffer.from(keypair.publicKey)
    this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
    this.localSeqno = 0
    this.weakEncryption = this.keyStorage.isBasicTextBackend()
    this.subscribeAccount()

    const state = this.getState()
    this.emit('state-changed', state)
    log.info('Wallet created')
    const result = { ...state, mnemonic: [...mnemonic] }
    mnemonic.fill('')
    ;(mnemonic as string[]).length = 0
    return result
  }

  /**
   * Import a wallet from a 24-word mnemonic phrase.
   * Overwrites any existing wallet.
   */
  async importWallet(mnemonic: string[]): Promise<WalletState> {
    if (!this.initialized) {
      await this.init()
    }
    // Unsubscribe existing account state and wipe old keys
    this.unsubscribeAccount()
    if (this.keypair) {
      this.keypair.secretKey.fill(0)
      this.keypair.publicKey.fill(0)
      this.keypair = null
    }
    if (this.publicKey) {
      this.publicKey.fill(0)
      this.publicKey = null
    }
    this.keyStorage.destroy()

    // Delete old wallet file so importFromMnemonic can write a new one
    await this.keyStorage.deleteFile()

    this.keypair = await this.keyStorage.importFromMnemonic(mnemonic)
    mnemonic.fill('')
    ;(mnemonic as string[]).length = 0
    this.publicKey = Buffer.from(this.keypair.publicKey)
    this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
    this.localSeqno = 0
    this.currentBalance = '0'
    this.decryptFailed = false
    this.weakEncryption = this.keyStorage.isBasicTextBackend()
    this.subscribeAccount()

    const state = this.getState()
    this.emit('state-changed', state)
    log.info('Wallet imported from mnemonic')
    return state
  }

  /**
   * Delete the wallet: wipe keys from memory, remove file from disk, reset state.
   */
  async deleteWallet(): Promise<WalletState> {
    this.unsubscribeAccount()
    if (this.keypair) {
      this.keypair.secretKey.fill(0)
      this.keypair.publicKey.fill(0)
      this.keypair = null
    }
    if (this.publicKey) {
      this.publicKey.fill(0)
      this.publicKey = null
    }
    this.keyStorage.destroy()
    await this.keyStorage.deleteFile()
    this.walletContract = null
    this.localSeqno = 0
    this.currentBalance = '0'
    this.decryptFailed = false
    this.weakEncryption = false

    const state = this.getState()
    this.emit('state-changed', state)
    log.info('Wallet deleted')
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
    if (!this.publicKey || !this.walletContract) {
      return {
        isCreated: false,
        address: '',
        addressRaw: '',
        publicKey: '',
        balance: '0',
        decryptFailed: this.decryptFailed,
        weakEncryption: this.weakEncryption,
      }
    }

    return {
      isCreated: true,
      address: this.walletContract.address.toString({ bounceable: false }),
      addressRaw: this.walletContract.address.toRawString(),
      publicKey: this.publicKey.toString('hex'),
      balance: this.currentBalance,
      isLocked: this.keyStorage.isLocked(),
      decryptFailed: this.decryptFailed,
      weakEncryption: this.weakEncryption,
    }
  }

  /**
   * Retry getBalance until the wallet's shard liteserver responds.
   * The WS transport probe (getMasterchainInfo) validates the masterchain
   * connection but the wallet lives on a specific shard that may need a
   * separate ADNL handshake. Retrying getBalance warms up that path.
   */
  private async warmupLiteserverPool(): Promise<void> {
    const MAX_ATTEMPTS = 10
    const BASE_DELAY = 500
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        await this.getBalance()
        return
      } catch {
        if (i < MAX_ATTEMPTS - 1) {
          const delay = Math.min(BASE_DELAY * Math.pow(2, i), 5_000)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    }
    log.warn('Liteserver pool warmup: shard did not respond, proceeding with cached balance')
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
   * Convert a raw bridge transaction into the store format.
   * Returns null for zero-value entries (service messages) or malformed payloads.
   */
  private convertRawTx(tx: BridgeTransaction): WalletTransaction | null {
    const inMsg = tx.in_msg
    const outMsgs = tx.out_msgs ?? []

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

    // Reject entries missing the block-header timestamp to avoid the 1970 bug.
    const rawTime = Number(tx.now)
    if (!rawTime || !Number.isFinite(rawTime)) return null

    return {
      id: tx.hash || tx.lt || crypto.randomUUID(),
      type,
      amount,
      address: counterparty,
      timestamp: rawTime * 1000,
      status: 'confirmed' as const,
      hash: tx.hash ?? '',
    }
  }

  /**
   * Fetch on-chain transaction history and convert to WalletTransaction format.
   */
  async fetchOnChainHistory(limit: number = WALLET_HISTORY_DEFAULT_LIMIT): Promise<WalletTransaction[]> {
    if (!this.wsBridge || !this.walletContract) return []

    try {
      const rawTxs = await this.wsBridge.getTransactions(this.walletContract.address.toString(), limit)
      return rawTxs.map((tx) => this.convertRawTx(tx)).filter((tx): tx is WalletTransaction => tx !== null)
    } catch (error) {
      log.error('Failed to fetch on-chain history:', error)
      throw error
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
    const { boc } = await this.buildBoc(Address.parse(to), BigInt(amount), WALLET_MAX_TIMEOUT_S)
    return boc
  }

  /**
   * Sign an x402 payment and return the ExactTonPayload.
   */
  async signX402Payment(paymentReq: PaymentRequirements): Promise<ExactTonPayload> {
    if (!this.publicKey || !this.walletContract) throw new Error('Wallet not initialized')
    await this.syncSeqno()
    const { boc, seqno, validUntil } = await this.buildBoc(
      Address.parseRaw(paymentReq.payTo),
      BigInt(paymentReq.amount),
      paymentReq.maxTimeoutSeconds
    )
    this.emit('payment-signed', paymentReq)
    log.info(`x402 payment signed: ${paymentReq.amount} nanoTON to ${paymentReq.payTo.substring(0, 12)}...`)
    return {
      signedBoc: boc,
      walletPublicKey: this.publicKey.toString('hex'),
      walletAddress: this.walletContract.address.toRawString(),
      seqno,
      validUntil,
    }
  }

  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    if (!this.wsBridge) throw new Error('Bridge not connected')
    return await this.wsBridge.resolveDomain(domain)
  }

  async resolveRecipient(input: string): Promise<{ address: string; domain?: string }> {
    const trimmed = input.trim()
    const normalized = trimmed.toLowerCase()

    if (!isTonDomain(normalized)) {
      const parsed = Address.parse(trimmed)
      if (parsed.workChain === -1) {
        throw new Error('Masterchain addresses not supported')
      }
      return { address: trimmed }
    }

    for (let i = 0; i < normalized.length; i++) {
      if (normalized.charCodeAt(i) > 127) {
        throw new Error('Non-ASCII domain not allowed')
      }
    }

    if (!TON_DOMAIN_REGEX.test(normalized)) {
      throw new Error('Invalid domain format')
    }

    if (!this.wsBridge) {
      throw new Error('Bridge not connected')
    }

    let result: DnsResolveResult
    try {
      result = await this.wsBridge.resolveDomain(normalized)
    } catch {
      throw new Error('Domain not registered')
    }

    if (!result.initialized) {
      throw new Error('Domain not initialized')
    }

    if (result.expiring_at && result.expiring_at < Math.floor(Date.now() / 1000)) {
      throw new Error('Domain expired')
    }

    const address = result.wallet || result.owner
    if (!address) {
      throw new Error('Domain has no wallet or owner')
    }

    const parsed = Address.parse(address)
    if (parsed.workChain === -1) {
      throw new Error('Masterchain addresses not supported')
    }

    return { address, domain: normalized }
  }

  private buildBoc(
    to: Address,
    amount: bigint,
    maxTimeout: number
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    // Serialize signing through a promise chain to prevent concurrent
    // calls from reading the same localSeqno before it is incremented.
    const result = this.signLock.then(() => this._buildBocInner(to, amount, maxTimeout))
    this.signLock = result.then(
      () => {},
      () => {}
    )
    return result
  }

  private async _buildBocInner(
    to: Address,
    amount: bigint,
    maxTimeout: number
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    if (!this.walletContract) throw new Error('Wallet not initialized')

    // Load secret key on demand if locked or wiped by timer
    if (!this.keypair || this.keyStorage.isLocked()) {
      this.keypair = await this.keyStorage.load()
    }

    const seqno = this.localSeqno
    const validUntil = seqno === 0 ? Math.floor(Date.now() / 1000) + 3600 : Math.floor(Date.now() / 1000) + maxTimeout

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

    // Sign-then-wipe: lock() zeroes the shared buffer AND nullifies the cache
    this.keyStorage.lock()
    this.keypair = null

    this.localSeqno++
    return { boc: extMsg.toBoc().toString('base64'), seqno, validUntil }
  }

  /**
   * Update the auto-lock timer duration at runtime.
   */
  setAutoLockMinutes(minutes: number): void {
    this.keyStorage.setAutoLockMinutes(minutes)
  }

  /**
   * Stop timers and wipe keys from memory.
   */
  destroy(): void {
    // Skip RPC unsubscribe: disconnect() clears subscriptions locally
    // and the server drops them when the WebSocket closes.
    this.unsubAccountState = null
    this.unsubTransactions = null
    this.keyStorage.destroy()
    if (this.keypair) {
      this.keypair.secretKey.fill(0)
      this.keypair.publicKey.fill(0)
      this.keypair = null
    }
    if (this.publicKey) {
      this.publicKey.fill(0)
      this.publicKey = null
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

    this.unsubAccountState = this.wsBridge.subscribeAccountState(address, (state: BridgeAccountState) => {
      const balance = state.balance ?? this.currentBalance
      if (balance !== this.currentBalance) {
        this.currentBalance = balance
        this.emit('balance-updated', this.currentBalance)
      }
    })

    // Refresh balance inline with the tx push so both events reach the renderer
    // in the same tick, avoiding a visible gap between list and solde updates.
    this.unsubTransactions = this.wsBridge.subscribeTransactions(address, (tx: BridgeTransaction) => {
      const formatted = this.convertRawTx(tx)
      if (!formatted) return
      this.emit('new-transaction', formatted)
      this.getBalance().catch((err) => log.debug('Balance refresh after tx push failed:', err))
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
      const msg = (error as Error).message ?? ''
      if (msg.includes('not initialized') || msg.includes('-256')) {
        log.debug('Seqno sync: contract not yet deployed, using local seqno')
      } else {
        log.error('Seqno sync failed:', error)
      }
    }
  }
}

// Singleton removed: use ServiceRegistry from services.ts
