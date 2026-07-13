/**
 * Wallet manager.
 * Singleton that manages the TON W5 v5r1 wallet lifecycle.
 */

import { EventEmitter } from 'events'
import { internal, beginCell, storeMessage, Address, SendMode, Cell, type MessageRelaxed } from '@ton/core'
import { sign } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import type {
  TonConnectOutMessage,
  TonProofReplyPayload,
  SignDataPayloadInput,
  SignDataResult,
} from '../tonconnect/types'
import { WalletKeyStorage, WalletDecryptionError } from './key-storage'
import { encodeCommentBody, normalizeComment } from './comment'
import type { ISecureStorage } from '../ports/secure-storage'
import type { MessengerBridgePort, TonBridgePort } from '../ports/ton-bridge'
import { WsBridgeClient } from './ws-bridge-client'
import { isContractNotDeployedError } from '../ports/ton-bridge'
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
import { WalletQueryService } from './query-service'
import { WalletSigningService } from './signing-service'
import { WalletTransferService } from './transfer-service'
import { WalletAccountService } from './account-service'
import { WalletSubscriptionService } from './subscription-service'
import { connectWalletBridge, prepareWalletBridge, warmupWalletBridge } from './bridge-lifecycle'
const log = createLogger('wallet')

export class WalletManager extends EventEmitter {
  private keyStorage: WalletKeyStorage
  private wsBridge: WsBridgeClient | null = null
  private wsBridgePort: number | null = null
  private walletContract: WalletContractV5R1 | null = null
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private publicKey: Buffer | null = null
  private localSeqno: number = 0
  private currentBalance: string = '0'
  private initialized: boolean = false
  private decryptFailed: boolean = false
  private weakEncryption: boolean = false
  private operationTail: Promise<void> = Promise.resolve()
  private queryService: WalletQueryService
  private signingService: WalletSigningService
  private transferService: WalletTransferService
  private accountService: WalletAccountService
  private subscriptionService = new WalletSubscriptionService()

  constructor(secureStorage?: ISecureStorage) {
    super()
    this.keyStorage = secureStorage ? new WalletKeyStorage(secureStorage) : new WalletKeyStorage()
    this.queryService = new WalletQueryService(() => this.wsBridge)
    this.signingService = new WalletSigningService({
      getAddress: () => this.walletContract?.address ?? null,
      nowSeconds: () => Math.floor(Date.now() / 1000),
      signDigest: (digest) => this.signWithKeyUnlocked((secretKey) => Buffer.from(sign(digest, secretKey))),
    })
    this.transferService = new WalletTransferService({
      getBridge: () => this.wsBridge,
      buildBoc: (messages, maxTimeout) => this.buildBoc(messages, maxTimeout),
      notifyStateChanged: () => this.emit('state-changed', this.getState()),
    })
    this.accountService = new WalletAccountService({
      getPublicKey: () => this.publicKey,
      getContract: () => this.walletContract,
    })
  }

  /**
   * Initialize the wallet manager. Load existing wallet or prepare for creation.
   */
  async init(): Promise<void> {
    if (this.initialized) return
    const startedAt = Date.now()

    const network = getSetting('network')
    const bridge = new WsBridgeClient(network.wsPort)
    try {
      await connectWalletBridge(bridge)
    } catch (error) {
      bridge.disconnect()
      throw error
    }
    this.wsBridge = bridge
    this.wsBridgePort = network.wsPort

    if (await this.keyStorage.exists()) {
      try {
        this.keypair = await this.keyStorage.load()
        this.publicKey = Buffer.from(this.keypair.publicKey)
        this.walletContract = WalletContractV5R1.create({ publicKey: this.keypair.publicKey, workchain: 0 })
        // warmup (balance priming) and seqno sync hit independent bridge
        // methods with no data dependency, so run them concurrently.
        await Promise.allSettled([
          warmupWalletBridge(() => this.getBalance()).then((ready) => {
            if (!ready) log.warn('Liteserver pool warmup: shard did not respond, proceeding with cached balance')
          }),
          this.syncSeqno(),
        ])
        this.subscribeAccount()
        const walletSettings = getSetting('wallet')
        this.keyStorage.setAutoLockMinutes(walletSettings.autoLockMinutes)
        if (this.keyStorage.isBasicTextBackend()) {
          this.weakEncryption = true
        }
        log.status('wallet.ready', `wallet ready · ${Date.now() - startedAt}ms`, {
          durationMs: Date.now() - startedAt,
        })
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
  async create(): Promise<WalletState & { mnemonic: string[] }> {
    // Ensure bridge is initialized before creating wallet
    if (!this.initialized) {
      await this.init()
    }

    return this.runExclusive(async () => {
      if (this.keypair || this.publicKey || this.walletContract) {
        throw new Error('Wallet already exists')
      }

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
    })
  }

  /**
   * Import a wallet from a 24-word mnemonic phrase.
   * Overwrites any existing wallet.
   */
  async importWallet(mnemonic: string[]): Promise<WalletState> {
    try {
      if (!this.initialized) {
        await this.init()
      }

      return await this.runExclusive(async () => {
        const importedKeypair = await this.keyStorage.importFromMnemonic(mnemonic)
        const importedContract = WalletContractV5R1.create({ publicKey: importedKeypair.publicKey, workchain: 0 })
        const previousKeypair = this.keypair
        const previousPublicKey = this.publicKey

        this.unsubscribeAccount()
        this.keypair = importedKeypair
        this.publicKey = Buffer.from(importedKeypair.publicKey)
        this.walletContract = importedContract

        if (previousKeypair && previousKeypair !== importedKeypair) {
          previousKeypair.secretKey.fill(0)
          previousKeypair.publicKey.fill(0)
        }
        if (previousPublicKey) {
          previousPublicKey.fill(0)
        }

        this.localSeqno = 0
        this.currentBalance = '0'
        this.decryptFailed = false
        this.weakEncryption = this.keyStorage.isBasicTextBackend()
        this.subscribeAccount()

        const state = this.getState()
        this.emit('state-changed', state)
        log.info('Wallet imported from mnemonic')
        return state
      })
    } finally {
      mnemonic.fill('')
      ;(mnemonic as string[]).length = 0
    }
  }

  /**
   * Delete the wallet: wipe keys from memory, remove file from disk, reset state.
   */
  async deleteWallet(): Promise<WalletState> {
    return this.runExclusive(async () => {
      await this.keyStorage.deleteFile()
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
      this.walletContract = null
      this.localSeqno = 0
      this.currentBalance = '0'
      this.decryptFailed = false
      this.weakEncryption = false

      const state = this.getState()
      this.emit('state-changed', state)
      log.info('Wallet deleted')
      return state
    })
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

  /** Narrow on-chain capability port for Cocoon; transport mechanics stay private. */
  getTonBridge(): TonBridgePort | null {
    return this.wsBridge
  }

  /** Narrow overlay/DHT capability port for Messenger; transport mechanics stay private. */
  getMessengerBridge(): MessengerBridgePort | null {
    return this.wsBridge
  }

  /**
   * Fetch current balance from the network.
   */
  async getBalance(): Promise<string> {
    const address = this.walletContract?.address.toString() ?? null
    const fetched = await this.queryService.getBalance(address, this.currentBalance)
    if (fetched !== this.currentBalance) {
      this.currentBalance = fetched
      this.emit('balance-updated', this.currentBalance)
    }
    return this.currentBalance
  }

  /**
   * Convert a raw bridge transaction into the store format.
   * Returns null for zero-value entries (service messages) or malformed payloads.
   */
  /**
   * Fetch on-chain transaction history and convert to WalletTransaction format.
   */
  async fetchOnChainHistory(limit: number = WALLET_HISTORY_DEFAULT_LIMIT): Promise<WalletTransaction[]> {
    return this.queryService.fetchOnChainHistory(this.walletContract?.address.toString() ?? null, limit)
  }

  /**
   * Sign and broadcast a TON transfer.
   * An optional comment is attached as a standard on-chain text-comment body.
   */
  async send(to: string, amount: string, comment?: string): Promise<WalletTransaction> {
    const bridge = this.wsBridge
    if (!bridge) throw new Error('Bridge not connected')
    const memo = normalizeComment(comment)
    const boc = await this.signTransfer(to, amount, memo)
    const bocBuffer = Buffer.from(boc, 'base64')

    let txHash: string | undefined
    let status: 'pending' | 'confirmed' = 'pending'
    try {
      txHash = await bridge.sendAndWatch(bocBuffer)
      status = 'confirmed'
    } catch {
      // Fallback: broadcast without waiting for confirmation
      await bridge.broadcast(bocBuffer)
    }

    const tx: WalletTransaction = {
      id: crypto.randomUUID(),
      type: 'send',
      amount,
      address: to,
      timestamp: Date.now(),
      status,
      hash: txHash,
      comment: memo,
    }

    this.emit('state-changed', this.getState())
    return tx
  }

  /**
   * Sign a transfer and return the BOC as base64.
   * When a comment is provided it is encoded as the message body (op=0 + text).
   */
  async signTransfer(to: string, amount: string, comment?: string): Promise<string> {
    const memo = normalizeComment(comment)
    const message = internal({
      to: Address.parse(to),
      value: BigInt(amount),
      bounce: false,
      body: memo ? encodeCommentBody(memo) : undefined,
    })
    const { boc } = await this.buildBoc([message], WALLET_MAX_TIMEOUT_S)
    return boc
  }

  /**
   * Sign an x402 payment and return the ExactTonPayload.
   */
  async signX402Payment(paymentReq: PaymentRequirements): Promise<ExactTonPayload> {
    return this.runExclusive(async () => {
      if (!this.publicKey || !this.walletContract) throw new Error('Wallet not initialized')
      await this.syncSeqnoUnlocked()
      const message = internal({
        to: Address.parseRaw(paymentReq.payTo),
        value: BigInt(paymentReq.amount),
        bounce: false,
      })
      const { boc, seqno, validUntil } = await this.buildBocUnlocked([message], paymentReq.maxTimeoutSeconds)
      this.emit('payment-signed', paymentReq)
      log.event('info', 'payment.signed', 'HTTP 402 payment signed')
      return {
        signedBoc: boc,
        walletPublicKey: this.publicKey.toString('hex'),
        walletAddress: this.walletContract.address.toRawString(),
        seqno,
        validUntil,
      }
    })
  }

  getTonConnectAccount(): { addressRaw: string; publicKey: string; walletStateInit: string } | null {
    return this.accountService.getTonConnectAccount()
  }

  async signTonConnectTransaction(messages: TonConnectOutMessage[]): Promise<string> {
    return this.transferService.signTonConnectTransaction(messages)
  }

  async signTonProof(domain: string, payload: string): Promise<TonProofReplyPayload> {
    return this.runExclusive(() => this.signingService.signTonProof(domain, payload))
  }

  async signData(domain: string, payload: SignDataPayloadInput): Promise<SignDataResult> {
    return this.runExclusive(() => this.signingService.signData(domain, payload))
  }

  private async signWithKeyUnlocked<T>(fn: (secretKey: Buffer) => T): Promise<T> {
    if (!this.keypair || this.keyStorage.isLocked()) {
      this.keypair = await this.keyStorage.load()
    }
    try {
      return fn(this.keypair.secretKey)
    } finally {
      this.keyStorage.lock()
      this.keypair = null
    }
  }

  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    return this.queryService.resolveDomain(domain)
  }

  async resolveRecipient(input: string): Promise<{ address: string; domain?: string }> {
    return this.queryService.resolveRecipient(input)
  }

  private buildBoc(
    messages: MessageRelaxed[],
    maxTimeout: number
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    // Serialize signing through a promise chain to prevent concurrent
    // calls from reading the same localSeqno before it is incremented.
    return this.runExclusive(async () => {
      await this.syncSeqnoUnlocked()
      return this.buildBocUnlocked(messages, maxTimeout)
    })
  }

  private runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(
      () => {},
      () => {}
    )
    return result
  }

  private async buildBocUnlocked(
    messages: MessageRelaxed[],
    maxTimeout: number
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    if (!this.walletContract) throw new Error('Wallet not initialized')

    // Load secret key on demand if locked or wiped by timer
    if (!this.keypair || this.keyStorage.isLocked()) {
      this.keypair = await this.keyStorage.load()
    }

    const seqno = this.localSeqno
    // W5 v5r1 first-deploy convention: x402 facilitator accepts validUntil=0xFFFFFFFF
    // as the marker for an uninitialized wallet. Any other value triggers the
    // "too far in the future" expiry check when maxTimeoutSeconds is tight.
    const validUntil = seqno === 0 ? 0xffffffff : Math.floor(Date.now() / 1000) + maxTimeout

    const transfer = this.walletContract.createTransfer({
      seqno,
      secretKey: this.keypair.secretKey,
      messages,
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

  applyBridgePort(wsPort: number): Promise<void> {
    return this.runExclusive(async () => {
      const previous = this.wsBridge
      if (!previous) return
      const next = await prepareWalletBridge(previous, this.wsBridgePort, wsPort)
      if (next === previous) return
      this.unsubscribeAccount()
      this.wsBridge = next
      this.wsBridgePort = wsPort
      previous.disconnect()
      this.subscribeAccount()
    })
  }

  /**
   * Stop timers and wipe keys from memory.
   */
  destroy(): void {
    // Skip RPC unsubscribe: disconnect() clears subscriptions locally
    // and the server drops them when the WebSocket closes.
    this.subscriptionService.stop()
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
    this.wsBridgePort = null
    this.walletContract = null
    this.initialized = false
    log.info('Wallet manager destroyed')
  }

  private subscribeAccount(): void {
    if (!this.wsBridge || !this.walletContract) return
    const address = this.walletContract.address.toString()

    this.subscriptionService.start(this.wsBridge, address, {
      currentBalance: () => this.currentBalance,
      balanceChanged: (balance) => {
        this.currentBalance = balance
        this.emit('balance-updated', balance)
      },
      convertTransaction: (transaction) => this.queryService.convertRawTransaction(transaction),
      transactionReceived: (transaction) => this.emit('new-transaction', transaction),
      refreshBalance: () => this.getBalance(),
      refreshFailed: (error) => log.debug('Balance refresh after tx push failed:', error),
    })
  }

  private unsubscribeAccount(): void {
    this.subscriptionService.stop()
  }

  private syncSeqno(): Promise<void> {
    return this.runExclusive(() => this.syncSeqnoUnlocked())
  }

  private async syncSeqnoUnlocked(): Promise<void> {
    if (!this.wsBridge || !this.walletContract) return
    try {
      const onChainSeqno = await this.wsBridge.getSeqno(this.getState().address)
      // Trust the chain. Math.max would pin localSeqno ahead of chain when a sign is consumed
      // locally but the remote never broadcasts (failed verify/settle in x402 fire-and-forget).
      this.localSeqno = onChainSeqno
    } catch (error) {
      if (isContractNotDeployedError(error)) {
        log.debug('Seqno sync: contract not yet deployed, using local seqno')
      } else {
        log.error('Seqno sync failed:', error)
      }
    }
  }
}

// Singleton removed: use ServiceRegistry from services.ts
