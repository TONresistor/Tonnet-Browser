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
import type { ISecureStorage } from '../ports/secure-storage'
import type { MessengerBridgePort, TonBridgePort } from '../ports/ton-bridge'
import { WsBridgeClient } from './ws-bridge-client'
import { isContractNotDeployedError } from '../ports/ton-bridge'
import { getSetting } from '../settings'
import { WALLET_HISTORY_DEFAULT_LIMIT } from './constants'
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
import { connectWalletBridge, prepareWalletBridge, warmupWalletBridge } from './bridge-lifecycle'
import { buildExternalWalletBoc } from './wallet-boc'
import { createWalletContract, type SupportedWalletContract, type WalletVersion } from './wallet-versions'
import { buildWalletState } from './wallet-state'
import { WalletIdentityTracker, type WalletIdentitySnapshot } from './wallet-identity'
import { WalletRuntimeState } from './wallet-runtime-state'
import { wipeKeypair, wipePublicKey } from './key-memory'
import type { TransferPreflightResult } from './transfer-preflight'
const log = createLogger('wallet')
export class WalletManager extends EventEmitter {
  private keyStorage: WalletKeyStorage
  private wsBridge: WsBridgeClient | null = null
  private wsBridgePort: number | null = null
  private walletContract: SupportedWalletContract | null = null
  private walletVersion: WalletVersion = 'v5R1'
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private publicKey: Buffer | null = null
  private initialized: boolean = false
  private decryptFailed: boolean = false
  private weakEncryption: boolean = false
  private needsPasswordSetup: boolean = false
  private backupVerified: boolean = false
  private passwordProtected: boolean = false
  private identity = new WalletIdentityTracker()
  private runtime = new WalletRuntimeState()
  private operationTail: Promise<void> = Promise.resolve()
  private queryService: WalletQueryService
  private signingService: WalletSigningService
  private transferService: WalletTransferService
  private accountService: WalletAccountService
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
      getAccountInformation: (address) => {
        if (!this.wsBridge) throw new Error('Bridge not connected')
        return this.wsBridge.getAccountInformation(address)
      },
      emulateTransaction: (address, boc) => {
        if (!this.wsBridge) throw new Error('Bridge not connected')
        return this.wsBridge.emulateTransaction(address, boc)
      },
      buildBoc: (messages, maxTimeout, expectedAddress, expectedIdentity) =>
        this.buildBoc(messages, maxTimeout, expectedAddress, expectedIdentity),
      withPreflightState: (expectedIdentity, operation) =>
        this.runExclusive(async () => {
          this.assertWalletIdentity(expectedIdentity)
          if (!this.walletContract) throw new Error('Wallet not initialized')
          await this.syncSeqnoUnlocked(true)
          return operation(this.walletContract, this.runtime.seqno)
        }),
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
        this.passwordProtected = metadata?.passwordProtected ?? false
        if (metadata?.publicKey) {
          this.publicKey = Buffer.from(metadata.publicKey)
          this.walletVersion = metadata.walletVersion
          this.walletContract = createWalletContract(this.walletVersion, metadata.publicKey)
          this.backupVerified = metadata.backupVerified
        } else {
          this.keypair = await this.keyStorage.load()
          this.publicKey = Buffer.from(this.keypair.publicKey)
          this.walletVersion = metadata?.walletVersion ?? 'v5R1'
          this.walletContract = createWalletContract(this.walletVersion, this.keypair.publicKey)
          this.backupVerified = metadata?.backupVerified ?? false
        }
        this.identity.advance()
        await Promise.allSettled([
          warmupWalletBridge(() => this.getBalance()).then((ready) => {
            if (!ready) log.warn('Liteserver pool warmup: shard did not respond, proceeding with cached balance')
          }),
          this.syncSeqno(),
        ])
        this.subscribeAccount()
        const walletSettings = getSetting('wallet')
        this.keyStorage.setAutoLockMinutes(walletSettings.autoLockMinutes)
        this.weakEncryption = !this.passwordProtected && this.keyStorage.isBasicTextBackend()
        this.needsPasswordSetup = !this.passwordProtected
        if (this.needsPasswordSetup) {
          this.keyStorage.lock()
          this.keypair = null
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
  async create(options: { password?: string }): Promise<WalletState & { mnemonic: string[] }> {
    const { password } = options
    if (!this.initialized) {
      await this.init()
    }
    return this.runExclusive(async () => {
      if (!password) throw new Error('A wallet password is required')
      if (this.keypair || this.publicKey || this.walletContract) {
        throw new Error('Wallet already exists')
      }
      if (this.decryptFailed) {
        throw new Error('Recover or explicitly delete the unreadable wallet before creating a new one')
      }
      const { keypair, mnemonic } = await this.keyStorage.generateFromMnemonic(password)
      this.keypair = keypair
      this.publicKey = Buffer.from(keypair.publicKey)
      this.walletVersion = 'v5R1'
      this.walletContract = createWalletContract(this.walletVersion, this.keypair.publicKey)
      this.runtime.resetAccount()
      this.weakEncryption = false
      this.passwordProtected = true
      this.needsPasswordSetup = false
      this.backupVerified = false
      this.identity.advance()
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
    walletVersion: WalletVersion = 'v5R1'
  ): Promise<WalletState> {
    try {
      if (!this.initialized) {
        await this.init()
      }
      return await this.runExclusive(async () => {
        if (!password) throw new Error('A wallet password is required')
        const importedKeypair = await this.keyStorage.importFromMnemonic(mnemonic, password, walletVersion)
        const importedContract = createWalletContract(walletVersion, importedKeypair.publicKey)
        const previousKeypair = this.keypair
        const previousPublicKey = this.publicKey
        this.keypair = importedKeypair
        this.publicKey = Buffer.from(importedKeypair.publicKey)
        this.walletContract = importedContract
        this.walletVersion = walletVersion
        wipeKeypair(previousKeypair, importedKeypair)
        wipePublicKey(previousPublicKey)
        this.runtime.resetAccount()
        this.decryptFailed = false
        this.weakEncryption = false
        this.passwordProtected = true
        this.needsPasswordSetup = false
        this.backupVerified = true
        this.identity.advance()
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

  async authenticatePassword(password: string): Promise<void> {
    return this.runExclusive(() => this.keyStorage.authenticatePassword(password))
  }

  async getForgetSnapshot(): Promise<{ fingerprint: string } | null> {
    const fingerprint = await this.keyStorage.getStorageFingerprint()
    return fingerprint ? { fingerprint } : null
  }

  async forgetWallet(expectedFingerprint: string): Promise<WalletState> {
    return this.runExclusive(async () => {
      const { recoveryId } = await this.keyStorage.quarantine(expectedFingerprint)
      const state = this.resetWalletAfterRemoval()
      log.info(`Wallet removed from this device; encrypted recovery preserved as ${recoveryId}`)
      return state
    })
  }

  async deleteWallet(password: string, expectedIdentity: WalletIdentitySnapshot): Promise<WalletState> {
    return this.runExclusive(async () => {
      this.assertWalletIdentity(expectedIdentity)
      await this.keyStorage.authenticatePassword(password)
      await this.keyStorage.deleteFile()
      const state = this.resetWalletAfterRemoval()
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
      this.passwordProtected = true
      this.backupVerified = metadata?.backupVerified ?? false
      this.lock()
      return this.unlockUnlocked(password)
    })
  }
  async markBackupVerified(password: string | undefined, expectedPublicKey: string): Promise<WalletState> {
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
      balance: this.runtime.balance,
      isLocked: this.keyStorage.isLocked(),
      decryptFailed: this.decryptFailed,
      weakEncryption: this.weakEncryption,
      needsPasswordSetup: this.needsPasswordSetup,
      passwordProtected: this.passwordProtected,
      backupVerified: this.backupVerified,
      walletVersion: this.walletVersion,
    })
  }
  private resetWalletAfterRemoval(): WalletState {
    wipeKeypair(this.keypair)
    wipePublicKey(this.publicKey)
    this.keypair = null
    this.publicKey = null
    this.keyStorage.destroy()
    this.walletContract = null
    this.runtime.resetAccount()
    this.decryptFailed = false
    this.weakEncryption = false
    this.needsPasswordSetup = false
    this.backupVerified = false
    this.passwordProtected = false
    this.identity.advance()
    const state = this.getState()
    this.emit('state-changed', state)
    return state
  }
  getTonBridge(): TonBridgePort | null {
    return this.wsBridge
  }
  getMessengerBridge(): MessengerBridgePort | null {
    return this.wsBridge
  }
  async getBalance(expectedIdentity?: WalletIdentitySnapshot): Promise<string> {
    if (expectedIdentity) this.assertWalletIdentity(expectedIdentity)
    const address = this.walletContract?.address.toString() ?? null
    const fetched = await this.queryService.getBalance(address, this.runtime.balance)
    if (expectedIdentity) this.assertWalletIdentity(expectedIdentity)
    if (this.runtime.setBalance(fetched)) this.emit('balance-updated', fetched)
    return this.runtime.balance
  }
  async fetchOnChainHistory(limit: number = WALLET_HISTORY_DEFAULT_LIMIT): Promise<WalletTransaction[]> {
    return this.queryService.fetchOnChainHistory(this.walletContract?.address.toString() ?? null, limit)
  }
  async send(
    to: string,
    amount: string,
    comment?: string,
    expectedIdentity?: WalletIdentitySnapshot
  ): Promise<WalletTransaction> {
    return this.transferService.send(to, amount, comment, expectedIdentity)
  }
  async signTransfer(
    to: string,
    amount: string,
    comment?: string,
    expectedIdentity?: WalletIdentitySnapshot
  ): Promise<string> {
    return this.transferService.signTransfer(to, amount, comment, expectedIdentity)
  }

  async preflightTransfer(
    to: string,
    amount: string,
    comment: string | undefined,
    expectedIdentity: WalletIdentitySnapshot
  ): Promise<TransferPreflightResult> {
    return this.transferService.preflightTransfer(to, amount, comment, expectedIdentity)
  }

  async signX402Payment(
    paymentReq: PaymentRequirements,
    expectedIdentity: WalletIdentitySnapshot
  ): Promise<ExactTonPayload> {
    return this.runExclusive(async () => {
      this.assertWalletIdentity(expectedIdentity)
      if (!this.publicKey || !this.walletContract) throw new Error('Wallet not initialized')
      await this.syncSeqnoUnlocked(true)
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
    expectedAddress?: string,
    expectedIdentity?: WalletIdentitySnapshot
  ): Promise<{ boc: string; seqno: number; validUntil: number }> {
    return this.runExclusive(async () => {
      this.accountService.assertTonConnectAccount(expectedAddress)
      if (expectedIdentity) this.assertWalletIdentity(expectedIdentity)
      await this.syncSeqnoUnlocked(true)
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

    const addressRaw = this.walletContract.address.toRawString()
    const validUntil = Math.floor(Date.now() / 1000) + maxTimeout
    const seqno = await this.runtime.acquireSeqno(addressRaw, validUntil)
    try {
      const result = buildExternalWalletBoc({
        walletContract: this.walletContract,
        secretKey: this.keypair.secretKey,
        messages,
        seqno,
        maxTimeout,
        validUntil,
      })
      return result
    } catch (error) {
      await this.runtime.releaseSeqno(addressRaw, seqno)
      throw error
    }
  }

  private assertSigningReady(): void {
    if (this.needsPasswordSetup) throw new Error('Wallet password setup required')
    if (!this.backupVerified) throw new Error('Wallet backup verification required')
  }
  getIdentitySnapshot(): WalletIdentitySnapshot | null {
    return this.identity.snapshot(this.publicKey, this.walletContract?.address.toRawString() ?? null)
  }

  private assertWalletIdentity(expected: WalletIdentitySnapshot): void {
    this.identity.assertCurrent(this.getIdentitySnapshot(), expected)
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
    this.runtime.stopSubscription()
    this.keyStorage.destroy()
    wipeKeypair(this.keypair)
    wipePublicKey(this.publicKey)
    this.keypair = null
    this.publicKey = null
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
    this.runtime.startSubscription(this.wsBridge, address, {
      currentBalance: () => this.runtime.balance,
      balanceChanged: (balance) => {
        this.runtime.setBalance(balance)
        this.emit('balance-updated', balance)
      },
      convertTransaction: (transaction) => this.queryService.convertRawTransaction(transaction),
      transactionReceived: (transaction) => this.emit('new-transaction', transaction),
      refreshBalance: () => this.getBalance(),
      refreshFailed: (error) => log.debug('Balance refresh after tx push failed:', error),
    })
  }

  private unsubscribeAccount(): void {
    this.runtime.stopSubscription()
  }
  private syncSeqno(): Promise<void> {
    return this.runExclusive(() => this.syncSeqnoUnlocked(false))
  }

  private async syncSeqnoUnlocked(waitForPending: boolean): Promise<void> {
    if (!this.wsBridge || !this.walletContract) return
    const address = this.getState().address
    const addressRaw = this.walletContract.address.toRawString()
    await this.runtime.syncSeqno(
      addressRaw,
      async () => {
        try {
          return await this.wsBridge!.getSeqno(address)
        } catch (error) {
          if (!isContractNotDeployedError(error)) throw error
          log.debug('Seqno sync: contract not yet deployed, using local seqno')
          return 0
        }
      },
      waitForPending
    )
  }
}
