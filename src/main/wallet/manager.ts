import { EventEmitter } from 'events'
import { internal, Address, type MessageRelaxed } from '@ton/core'
import { sign } from '@ton/crypto'
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
import { buildExternalWalletBoc } from './wallet-boc'
import {
  createWalletContract,
  type MnemonicScheme,
  type SupportedWalletContract,
  type WalletVersion,
} from './wallet-versions'
import { parseTransferTarget } from './address-utils'
import { buildWalletState } from './wallet-state'
const log = createLogger('wallet')

export class WalletManager extends EventEmitter {
  private keyStorage: WalletKeyStorage
  private wsBridge: WsBridgeClient | null = null
  private wsBridgePort: number | null = null
  private walletContract: SupportedWalletContract | null = null
  private walletVersion: WalletVersion = 'v5R1'
  private mnemonicScheme: MnemonicScheme = 'ton'
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private publicKey: Buffer | null = null
  private localSeqno: number = 0
  private currentBalance: string = '0'
  private initialized: boolean = false
  private decryptFailed: boolean = false
  private weakEncryption: boolean = false
  private needsPasswordSetup: boolean = false
  private backupVerified: boolean = false
  private operationTail: Promise<void> = Promise.resolve()
  private queryService: WalletQueryService
  private signingService: WalletSigningService
  private transferService: WalletTransferService
  private accountService: WalletAccountService
  private subscriptionService = new WalletSubscriptionService()

  constructor(secureStorage?: ISecureStorage) {
    super()
    this.keyStorage = secureStorage ? new WalletKeyStorage(secureStorage) : new WalletKeyStorage()
    this.keyStorage.setOnLock(() => {
      this.keypair = null
      this.emit('state-changed', this.getState())
    })
    this.queryService = new WalletQueryService(() => this.wsBridge)
    this.signingService = new WalletSigningService({
      getAddress: () => this.walletContract?.address ?? null,
      nowSeconds: () => Math.floor(Date.now() / 1000),
      signDigest: (digest) => this.signWithKeyUnlocked((secretKey) => Buffer.from(sign(digest, secretKey))),
    })
    this.transferService = new WalletTransferService({
      getBridge: () => this.wsBridge,
      buildBoc: (messages, maxTimeout, expectedAddress) => this.buildBoc(messages, maxTimeout, expectedAddress),
      notifyStateChanged: () => this.emit('state-changed', this.getState()),
    })
    this.accountService = new WalletAccountService({
      getPublicKey: () => this.publicKey,
      getContract: () => this.walletContract,
    })
  }

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
        const metadata = await this.keyStorage.inspect()
        if (metadata?.passwordProtected && metadata.publicKey) {
          this.publicKey = Buffer.from(metadata.publicKey)
          this.walletVersion = metadata.walletVersion
          this.mnemonicScheme = metadata.mnemonicScheme
          this.walletContract = createWalletContract(this.walletVersion, metadata.publicKey)
          this.backupVerified = metadata.backupVerified
        } else {
          this.keypair = await this.keyStorage.load()
          this.publicKey = Buffer.from(this.keypair.publicKey)
          this.walletContract = createWalletContract(this.walletVersion, this.keypair.publicKey)
          this.needsPasswordSetup = true
        }
        await Promise.allSettled([
          warmupWalletBridge(() => this.getBalance()).then((ready) => {
            if (!ready) log.warn('Liteserver pool warmup: shard did not respond, proceeding with cached balance')
          }),
          this.syncSeqno(),
        ])
        this.subscribeAccount()
        const walletSettings = getSetting('wallet')
        this.keyStorage.setAutoLockMinutes(walletSettings.autoLockMinutes)
        this.weakEncryption = this.needsPasswordSetup && this.keyStorage.isBasicTextBackend()
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

  async create(password?: string): Promise<WalletState & { mnemonic: string[] }> {
    if (!this.initialized) {
      await this.init()
    }

    return this.runExclusive(async () => {
      if (this.keypair || this.publicKey || this.walletContract) {
        throw new Error('Wallet already exists')
      }

      if (this.decryptFailed) {
        throw new Error('Recover or explicitly delete the unreadable wallet before creating a new one')
      }

      const { keypair, mnemonic, mnemonicScheme } = await this.keyStorage.generateFromMnemonic(password, 'bip39')
      this.keypair = keypair
      this.publicKey = Buffer.from(keypair.publicKey)
      this.walletVersion = 'v5R1'
      this.mnemonicScheme = mnemonicScheme
      this.walletContract = createWalletContract(this.walletVersion, this.keypair.publicKey)
      this.localSeqno = 0
      this.weakEncryption = !password && this.keyStorage.isBasicTextBackend()
      this.needsPasswordSetup = !password
      this.backupVerified = false
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

  async importWallet(
    mnemonic: string[],
    password?: string,
    walletVersion: WalletVersion = 'v5R1',
    mnemonicScheme: MnemonicScheme = 'ton'
  ): Promise<WalletState> {
    try {
      if (!this.initialized) {
        await this.init()
      }

      return await this.runExclusive(async () => {
        const importedKeypair = await this.keyStorage.importFromMnemonic(
          mnemonic,
          password,
          walletVersion,
          mnemonicScheme
        )
        const importedContract = createWalletContract(walletVersion, importedKeypair.publicKey)
        const previousKeypair = this.keypair
        const previousPublicKey = this.publicKey

        this.unsubscribeAccount()
        this.keypair = importedKeypair
        this.publicKey = Buffer.from(importedKeypair.publicKey)
        this.walletContract = importedContract
        this.walletVersion = walletVersion
        this.mnemonicScheme = mnemonicScheme

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
        this.weakEncryption = !password && this.keyStorage.isBasicTextBackend()
        this.needsPasswordSetup = !password
        this.backupVerified = true
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
      this.needsPasswordSetup = false
      this.backupVerified = false

      const state = this.getState()
      this.emit('state-changed', state)
      log.info('Wallet deleted')
      return state
    })
  }

  async exportMnemonic(password?: string): Promise<{ mnemonic: string[] }> {
    const result = await this.keyStorage.getMnemonic(password)
    if (!result) {
      throw new Error('This wallet was created with a raw seed and has no mnemonic phrase')
    }
    return result
  }

  async unlock(password: string): Promise<WalletState> {
    return this.runExclusive(() => this.unlockUnlocked(password))
  }
  lock(): WalletState {
    this.keyStorage.lock()
    this.keypair = null
    return this.getState()
  }
  async setupPassword(password: string): Promise<WalletState> {
    return this.runExclusive(async () => {
      await this.keyStorage.protectWithPassword(password)
      const metadata = await this.keyStorage.inspect()
      this.needsPasswordSetup = false
      this.weakEncryption = false
      this.backupVerified = metadata?.backupVerified ?? false
      this.lock()
      return this.unlockUnlocked(password)
    })
  }

  async markBackupVerified(password: string, expectedPublicKey: string): Promise<WalletState> {
    return this.runExclusive(async () => {
      if (!this.publicKey || this.publicKey.toString('hex') !== expectedPublicKey) {
        throw new Error('Wallet identity changed during backup verification')
      }
      await this.keyStorage.markBackupVerified(password)
      this.backupVerified = true
      const state = this.getState()
      this.emit('state-changed', state)
      return state
    })
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<WalletState> {
    return this.runExclusive(async () => {
      await this.keyStorage.changePassword(currentPassword, nextPassword)
      this.lock()
      return this.unlockUnlocked(nextPassword)
    })
  }

  getState(): WalletState {
    return buildWalletState({
      publicKey: this.publicKey,
      contract: this.walletContract,
      balance: this.currentBalance,
      isLocked: this.keyStorage.isLocked(),
      decryptFailed: this.decryptFailed,
      weakEncryption: this.weakEncryption,
      needsPasswordSetup: this.needsPasswordSetup,
      backupVerified: this.backupVerified,
      walletVersion: this.walletVersion,
      mnemonicScheme: this.mnemonicScheme,
    })
  }

  getTonBridge(): TonBridgePort | null {
    return this.wsBridge
  }

  getMessengerBridge(): MessengerBridgePort | null {
    return this.wsBridge
  }

  async getBalance(): Promise<string> {
    const address = this.walletContract?.address.toString() ?? null
    const fetched = await this.queryService.getBalance(address, this.currentBalance)
    if (fetched !== this.currentBalance) {
      this.currentBalance = fetched
      this.emit('balance-updated', this.currentBalance)
    }
    return this.currentBalance
  }

  async fetchOnChainHistory(limit: number = WALLET_HISTORY_DEFAULT_LIMIT): Promise<WalletTransaction[]> {
    return this.queryService.fetchOnChainHistory(this.walletContract?.address.toString() ?? null, limit)
  }

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

  async signTransfer(to: string, amount: string, comment?: string): Promise<string> {
    const memo = normalizeComment(comment)
    const target = parseTransferTarget(to)
    const message = internal({
      to: target.address,
      value: BigInt(amount),
      bounce: target.bounce,
      body: memo ? encodeCommentBody(memo) : undefined,
    })
    const { boc } = await this.buildBoc([message], WALLET_MAX_TIMEOUT_S)
    return boc
  }

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

  async signTonConnectTransaction(messages: TonConnectOutMessage[], expectedAddress?: string): Promise<string> {
    return this.transferService.signTonConnectTransaction(messages, expectedAddress)
  }

  async signTonProof(domain: string, payload: string, expectedAddress?: string): Promise<TonProofReplyPayload> {
    return this.runExclusive(() => {
      this.accountService.assertTonConnectAccount(expectedAddress)
      return this.signingService.signTonProof(domain, payload)
    })
  }

  async signData(domain: string, payload: SignDataPayloadInput, expectedAddress?: string): Promise<SignDataResult> {
    return this.runExclusive(() => {
      this.accountService.assertTonConnectAccount(expectedAddress)
      return this.signingService.signData(domain, payload)
    })
  }

  private async signWithKeyUnlocked<T>(fn: (secretKey: Buffer) => T): Promise<T> {
    this.assertSigningReady()
    if (!this.keypair || this.keyStorage.isLocked()) {
      this.keypair = await this.keyStorage.load()
    }
    return fn(this.keypair.secretKey)
  }

  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    return this.queryService.resolveDomain(domain)
  }

  async resolveRecipient(input: string): Promise<{ address: string; domain?: string }> {
    return this.queryService.resolveRecipient(input)
  }

  private buildBoc(
    messages: MessageRelaxed[],
    maxTimeout: number,
    expectedAddress?: string
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    return this.runExclusive(async () => {
      this.accountService.assertTonConnectAccount(expectedAddress)
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

  private async unlockUnlocked(password: string): Promise<WalletState> {
    const keypair = await this.keyStorage.load(password)
    if (!this.publicKey || !keypair.publicKey.equals(this.publicKey)) throw new Error('Wallet identity mismatch')
    this.keypair = keypair
    const state = this.getState()
    this.emit('state-changed', state)
    return state
  }

  private async buildBocUnlocked(
    messages: MessageRelaxed[],
    maxTimeout: number
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    this.assertSigningReady()
    if (!this.walletContract) throw new Error('Wallet not initialized')

    if (!this.keypair || this.keyStorage.isLocked()) {
      this.keypair = await this.keyStorage.load()
    }

    const result = buildExternalWalletBoc({
      walletContract: this.walletContract,
      secretKey: this.keypair.secretKey,
      messages,
      seqno: this.localSeqno,
      maxTimeout,
    })

    this.localSeqno++
    return result
  }

  private assertSigningReady(): void {
    if (this.needsPasswordSetup) throw new Error('Wallet password setup required')
    if (!this.backupVerified) throw new Error('Wallet backup verification required')
  }

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

  destroy(): void {
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
