import { EventEmitter } from 'events'
import { Address, type Cell } from '@ton/core'
import { randomUUID } from 'node:crypto'
import { sign } from '@ton/crypto'
import type { TonConnectOutMessage, TonProofReplyPayload, SignDataPayloadInput, SignDataResult } from './signing-types'
import { WalletKeyStorage, WalletDecryptionError, WalletSystemStorageError } from './key-storage'
import type { SecureStorage, VaultPersistence, JournalStore } from './ports'
import { OperationJournal, intentFingerprint, type WalletOperation } from './journal'
import { WalletTransfers, type TransferIntent, type TransferAuthorization } from './transactions'
import { createTonTransferMessage } from './transfer-message'
import {
  createEncryptedCommentBody,
  parseRecipientPublicKey,
  decryptEncryptedComment,
  validateEncryptedCommentBody,
  type DecryptCommentRequest,
} from './encrypted-comment'
import { WalletEngineError } from './errors'
import { WalletHistoryManager } from './history'
import { WalletBackupVerifier } from './backup-verifier'
import type { BridgeProvider } from './ports'
import { WALLET_HISTORY_DEFAULT_LIMIT } from './constants'
import type { WalletState, WalletTransaction, DnsResolveResult } from './schemas'
import { createLogger, type WalletLogger } from './logger'
import { WalletQueryService } from './query-service'
import { WalletSigningService } from './signing-service'

import { WalletAccountService } from './account-service'
import { warmupWalletBridge } from './bridge-warmup'
import type { WalletBridgePort } from './bridge-port'

import {
  deriveWalletKeyPair,
  validateTonMnemonic,
  createWalletContract,
  type SupportedWalletContract,
  type WalletVersion,
} from './wallet-versions'
import { buildWalletState } from './wallet-state'
import { WalletIdentityTracker, type WalletIdentitySnapshot } from './wallet-identity'
import { WalletRuntimeState } from './wallet-runtime-state'
import { wipeKeypair, wipePublicKey } from './key-memory'

export interface WalletEngineOptions {
  logger?: WalletLogger
  secureStorage: SecureStorage
  vault: VaultPersistence
  journal: JournalStore
  bridge: BridgeProvider<WalletBridgePort>
  history: WalletHistoryManager
  legacyPending?: () => Promise<Record<string, { seqno: number; validUntil: number }>>
  autoLockMinutes?: number
  fallbackHistory?: (address: string, limit: number) => Promise<WalletTransaction[]>
}
export type WalletSnapshot = Readonly<
  WalletState & {
    revision: number
    sessionRevision: number
    operations: readonly WalletOperation[]
    transactions: readonly WalletTransaction[]
  }
>

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child)
    Object.freeze(value)
  }
  return value
}

export class WalletEngine extends EventEmitter {
  private readonly log: WalletLogger
  private keyStorage: WalletKeyStorage
  private readonly disposeBridgeChanged: () => void
  private readonly disposeHistoryChanged: () => void
  private publishedSnapshot!: WalletSnapshot
  private snapshotFingerprint = ''
  private readonly snapshotWaiters = new Set<{
    after: number
    resolve: () => void
    reject: (error: Error) => void
  }>()
  private balanceGeneration = 0
  private historyGeneration = 0
  private historyVisible = true
  private walletContract: SupportedWalletContract | null = null
  private walletVersion: WalletVersion = 'v5R1'
  private keypair: { publicKey: Buffer; secretKey: Buffer } | null = null
  private publicKey: Buffer | null = null
  private initialized: boolean = false
  private initializationTask: Promise<void> | null = null
  private decryptFailed: boolean = false
  private systemStorageBlocked: boolean = false
  private weakEncryption: boolean = false
  private needsPasswordSetup: boolean = false
  private backupVerified: boolean = false
  private passwordProtected: boolean = false
  private identity = new WalletIdentityTracker()
  private runtime = new WalletRuntimeState()
  private operationTail: Promise<void> = Promise.resolve()
  private queryService: WalletQueryService
  private signingService: WalletSigningService
  private transfers: WalletTransfers
  private backupVerifier = new WalletBackupVerifier()
  private journal: OperationJournal
  private sessionRevision = 0
  private sessionAbort = new AbortController()
  private recoveryTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private shutdownTask: Promise<void> | null = null
  private replacingWallet = false
  private bridgeProvider: BridgeProvider<WalletBridgePort>
  private accountService: WalletAccountService
  constructor(private readonly options: WalletEngineOptions) {
    super()
    this.log = options.logger ?? createLogger('wallet')
    this.bridgeProvider = options.bridge
    this.keyStorage = new WalletKeyStorage(options.secureStorage, options.vault, this.log)
    this.journal = new OperationJournal(options.journal)
    this.transfers = new WalletTransfers(
      {
        identity: () => {
          const identity = this.getIdentitySnapshot()
          if (!identity) throw new Error('Wallet not initialized')
          return identity
        },
        contract: () => {
          if (!this.walletContract) throw new Error('Wallet not initialized')
          return this.walletContract
        },
        session: () => this.sessionRevision,
        signal: () => this.sessionAbort.signal,
        assertReady: () => this.assertSigningReady(),
        provider: () => {
          const bridge = this.getBridge()
          if (!bridge) throw new Error('Bridge not connected')
          return bridge
        },
        withSecret: (operation) => this.signWithKeyUnlocked(operation),
        changed: (operation) => this.publishOperation(operation),
        submissionFailed: (error) => this.log.warn('Wallet submission was not confirmed:', error),
      },
      this.journal
    )
    this.keyStorage.setOnLock(() => {
      this.invalidateSession()
      this.backupVerifier.clear()
      this.journal.lock()
      this.stopRecovery()
      this.keypair = null
      this.publishState()
    })
    this.queryService = new WalletQueryService(() => this.getBridge(), this.log)
    this.signingService = new WalletSigningService({
      getAddress: () => this.walletContract?.address ?? null,
      nowSeconds: () => Math.floor(Date.now() / 1000),
      signDigest: (digest) => this.signWithKeyUnlocked((secretKey) => Buffer.from(sign(digest, secretKey))),
    })
    this.accountService = new WalletAccountService({
      getPublicKey: () => this.publicKey,
      getContract: () => this.walletContract,
    })
    this.publishedSnapshot = freezeSnapshot({
      ...this.getState(),
      revision: 0,
      sessionRevision: 0,
      operations: [],
      transactions: [],
    })
    this.disposeHistoryChanged = options.history.onChanged(() => this.publishSnapshot())
    this.disposeBridgeChanged = this.bridgeProvider.onBridgeChanged((bridge) => {
      this.queryService.clearRecipientCache()
      this.balanceGeneration++
      this.unsubscribeAccount()
      if (!bridge || !this.initialized || !this.walletContract) return
      this.subscribeAccount()
      void this.refreshBridgeState()
    })
  }
  init(): Promise<void> {
    if (this.closed) return Promise.reject(new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down'))
    if (this.initializationTask) return this.initializationTask
    if (this.initialized) return Promise.resolve()
    const startedAt = Date.now()
    const task = this.runExclusive(() => this.initializeStorage())
      .then(async () => {
        if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
        // Network warmup must not hold the vault mutation queue or delay shutdown.
        if (this.walletContract && this.getBridge()) {
          this.subscribeAccount()
          await this.refreshBridgeState()
        }
        if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
        if (this.walletContract) {
          this.log.status('wallet.ready', `wallet ready · ${Date.now() - startedAt}ms`, {
            durationMs: Date.now() - startedAt,
          })
        }
        this.publishState()
      })
      .finally(() => {
        if (this.initializationTask === task) this.initializationTask = null
      })
    this.initializationTask = task
    return task
  }
  private async initializeStorage(): Promise<void> {
    const session = this.sessionRevision
    let walletExists: boolean
    try {
      walletExists = await this.keyStorage.exists()
    } catch (error) {
      this.assertSessionRevision(session)
      this.systemStorageBlocked = true
      this.initialized = true
      this.log.error('Wallet storage is unavailable:', error)
      this.publishState()
      return
    }
    this.assertSessionRevision(session)
    if (walletExists) {
      try {
        const metadata = await this.keyStorage.inspect()
        this.assertSessionRevision(session)
        this.passwordProtected = metadata?.passwordProtected ?? false
        if (metadata?.publicKey) {
          this.publicKey = Buffer.from(metadata.publicKey)
          this.walletVersion = metadata.walletVersion
          this.walletContract = createWalletContract(this.walletVersion, metadata.publicKey)
          this.backupVerified = metadata.backupVerified
        } else {
          const keypair = await this.keyStorage.load()
          this.assertSessionRevision(session)
          this.keypair = keypair
          this.publicKey = Buffer.from(this.keypair.publicKey)
          this.walletVersion = metadata?.walletVersion ?? 'v5R1'
          this.walletContract = createWalletContract(this.walletVersion, this.keypair.publicKey)
          this.backupVerified = metadata?.backupVerified ?? false
        }
        this.identity.advance()
        this.keyStorage.setAutoLockMinutes(this.options.autoLockMinutes ?? 5)
        this.weakEncryption = !this.passwordProtected && this.keyStorage.isBasicTextBackend()
        this.needsPasswordSetup = !this.passwordProtected
        if (this.needsPasswordSetup) {
          this.keyStorage.lock()
          this.keypair = null
        }
      } catch (error) {
        this.assertSessionRevision(session)
        if (error instanceof WalletSystemStorageError) {
          this.log.error('System secure storage is unavailable:', error)
          this.systemStorageBlocked = true
          this.publishState()
        } else if (error instanceof WalletDecryptionError) {
          this.log.error('Wallet decryption failed (keyring backend may have changed):', error)
          this.decryptFailed = true
          this.publishState()
        } else {
          this.log.error('Failed to load wallet:', error)
        }
      }
    } else {
      this.log.info('No wallet found, waiting for creation')
    }
    this.initialized = true
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
      if (this.systemStorageBlocked) {
        throw new Error('Unlock system secure storage before creating a wallet')
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
      const session = this.sessionRevision
      await this.resetVisibleHistory()
      this.assertWalletSession(session)
      await this.openJournal()
      this.assertWalletSession(session)
      this.subscribeAccount()
      const state = this.getState()
      this.publishState()
      this.log.info('Wallet created')
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
      if (this.systemStorageBlocked) {
        throw new Error('Unlock system secure storage before importing a wallet')
      }
      return await this.runExclusive(async () => {
        if (!password) throw new Error('A wallet password is required')
        const preparationSession = this.sessionRevision
        if (!(await validateTonMnemonic(mnemonic))) throw new Error('Invalid mnemonic phrase')
        this.assertSessionRevision(preparationSession)
        const candidateKeys = await deriveWalletKeyPair(mnemonic)
        const candidate = new OperationJournal(this.options.journal)
        try {
          this.assertSessionRevision(preparationSession)
          this.replacingWallet = true
          this.invalidateSession()
          const importSession = this.sessionRevision
          // Cancel old continuations and settle their writes before reading the replacement journal.
          // A failed send can leave a rejected tail; the durable journal is validated below.
          await this.journal.flush().catch(() => undefined)
          this.assertSessionRevision(importSession)
          const address = createWalletContract(walletVersion, candidateKeys.publicKey).address.toRawString()
          await candidate.open(candidateKeys.secretKey, `mainnet:${address}`)
          this.assertSessionRevision(importSession)
          await this.importLegacyPending(candidate, address)
          this.assertSessionRevision(importSession)
          const importedKeypair = await this.keyStorage.importFromMnemonic(mnemonic, password, walletVersion)
          if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
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
          this.systemStorageBlocked = false
          this.weakEncryption = false
          this.passwordProtected = true
          this.needsPasswordSetup = false
          this.backupVerified = true
          this.identity.advance()
          this.invalidateSession()
          this.journal.lock()
          this.journal = candidate
          this.transfers.setJournal(candidate)
          const session = this.sessionRevision
          await this.resetVisibleHistory()
          this.replacingWallet = false
          this.startRecovery(session)
          this.subscribeAccount()

          const state = this.getState()
          this.publishState()
          this.log.info('Wallet imported from mnemonic')
          return state
        } catch (error) {
          if (this.journal !== candidate) candidate.lock()
          throw error
        } finally {
          wipeKeypair(candidateKeys)
          this.replacingWallet = false
          this.publishSnapshot()
        }
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
      await this.resetVisibleHistory()
      this.log.info(`Wallet removed from this device; encrypted recovery preserved as ${recoveryId}`)
      return state
    })
  }

  async deleteWallet(password: string, expectedIdentity: WalletIdentitySnapshot): Promise<WalletState> {
    return this.runExclusive(async () => {
      this.assertWalletIdentity(expectedIdentity)
      await this.keyStorage.authenticatePassword(password)
      await this.keyStorage.deleteFile()
      const state = this.resetWalletAfterRemoval()
      await this.resetVisibleHistory()
      this.log.info('Wallet deleted')
      return state
    })
  }
  async exportMnemonic(password?: string): Promise<{ mnemonic: string[] }> {
    if (this.closed) throw new Error('Wallet engine is shut down')
    const result = await this.keyStorage.getMnemonic(password)
    if (!result) {
      throw new Error('This wallet was created with a raw seed and has no mnemonic phrase')
    }
    return result
  }
  async unlock(password: string): Promise<WalletState> {
    const session = this.sessionRevision
    return this.runExclusive(() => {
      if (session !== this.sessionRevision) throw new Error('Wallet session changed')
      return this.unlockUnlocked(password)
    })
  }
  lock(): WalletState {
    this.invalidateSession()
    this.journal.lock()
    this.backupVerifier.clear()
    this.stopRecovery()
    this.keyStorage.lock()
    this.keypair = null
    this.publishSnapshot()
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
  async createBackupChallenge(password?: string): Promise<{ challengeId: string; indexes: number[] }> {
    const identity = this.getIdentitySnapshot()
    const session = this.sessionRevision
    if (!identity) throw new Error('Wallet not initialized')
    const result = await this.exportMnemonic(password)
    try {
      this.assertWalletIdentity(identity)
      if (session !== this.sessionRevision) throw new Error('Wallet session changed')
      return this.backupVerifier.create(result.mnemonic, JSON.stringify([identity, session]))
    } finally {
      result.mnemonic.fill('')
    }
  }
  async verifyBackup(challengeId: string, password: string | undefined, answers: string[]): Promise<WalletState> {
    const identity = this.getIdentitySnapshot()
    if (
      !identity ||
      !this.backupVerifier.verify(challengeId, JSON.stringify([identity, this.sessionRevision]), answers)
    )
      throw new Error('Recovery words do not match')
    return this.markBackupVerified(password, identity.publicKey)
  }
  private async markBackupVerified(password: string | undefined, expectedPublicKey: string): Promise<WalletState> {
    return this.runExclusive(async () => {
      if (!this.publicKey || this.publicKey.toString('hex') !== expectedPublicKey) {
        throw new Error('Wallet identity changed during backup verification')
      }
      await this.keyStorage.markBackupVerified(password)
      this.backupVerified = true
      const state = this.getState()
      this.publishState()
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
      systemStorageBlocked: this.systemStorageBlocked,
      weakEncryption: this.weakEncryption,
      needsPasswordSetup: this.needsPasswordSetup,
      passwordProtected: this.passwordProtected,
      backupVerified: this.backupVerified,
      walletVersion: this.walletVersion,
    })
  }
  private resetWalletAfterRemoval(): WalletState {
    this.invalidateSession()
    this.journal.lock()
    this.backupVerifier.clear()
    this.stopRecovery()
    wipeKeypair(this.keypair)
    wipePublicKey(this.publicKey)
    this.keypair = null
    this.publicKey = null
    this.keyStorage.destroy()
    this.walletContract = null
    this.runtime.resetAccount()
    this.decryptFailed = false
    this.systemStorageBlocked = false
    this.weakEncryption = false
    this.needsPasswordSetup = false
    this.backupVerified = false
    this.passwordProtected = false
    this.identity.advance()
    const state = this.getState()
    this.publishState()
    return state
  }
  async getBalance(expectedIdentity?: WalletIdentitySnapshot): Promise<string> {
    if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
    if (expectedIdentity) this.assertWalletIdentity(expectedIdentity)
    const generation = ++this.balanceGeneration
    const identity = this.getIdentitySnapshot()
    const address = this.walletContract?.address.toString() ?? null
    const fetched = await this.queryService.getBalance(address, this.runtime.balance)
    if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
    if (JSON.stringify(identity) !== JSON.stringify(this.getIdentitySnapshot()))
      throw new WalletEngineError('IDENTITY_CHANGED', 'Wallet identity changed')
    if (expectedIdentity) this.assertWalletIdentity(expectedIdentity)
    if (generation !== this.balanceGeneration) return this.runtime.balance
    if (this.runtime.setBalance(fetched)) {
      this.publishSnapshot()
      this.emit('balance-updated', fetched)
    }
    return this.runtime.balance
  }
  async fetchOnChainHistory(limit: number = WALLET_HISTORY_DEFAULT_LIMIT): Promise<WalletTransaction[]> {
    return this.queryService.fetchOnChainHistory(this.walletContract?.address.toString() ?? null, limit)
  }

  getTonConnectAccount(): { addressRaw: string; publicKey: string; walletStateInit: string } | null {
    return this.accountService.getTonConnectAccount()
  }

  async signTonConnectTransaction(
    messages: TonConnectOutMessage[],
    expectedAddress?: string,
    operationId: string = randomUUID(),
    validUntil?: number,
    expectedSession?: number,
    authorize?: TransferAuthorization
  ): Promise<string> {
    if (expectedSession !== undefined && expectedSession !== this.sessionRevision)
      throw new Error('Wallet session changed')
    this.accountService.assertTonConnectAccount(expectedAddress)
    const op = await this.sendTransfer(
      {
        operationId,
        validUntil,
        messages: messages.map((message) => ({
          ...message,
          bounce: Address.parseFriendly(message.address).isBounceable,
        })),
      },
      authorize
    )
    if (!op.boc) throw new Error('Signed operation unavailable')
    return op.boc
  }

  async signTonProof(
    domain: string,
    payload: string,
    expectedAddress?: string,
    expectedSession?: number
  ): Promise<TonProofReplyPayload> {
    if (expectedSession !== undefined && expectedSession !== this.sessionRevision)
      throw new Error('Wallet session changed')
    const session = expectedSession ?? this.sessionRevision
    return this.runExclusive(() => {
      if (session !== this.sessionRevision) throw new Error('Wallet session changed')
      this.accountService.assertTonConnectAccount(expectedAddress)
      return this.signingService.signTonProof(domain, payload)
    })
  }

  async signData(
    domain: string,
    payload: SignDataPayloadInput,
    expectedAddress?: string,
    expectedSession?: number
  ): Promise<SignDataResult> {
    if (expectedSession !== undefined && expectedSession !== this.sessionRevision)
      throw new Error('Wallet session changed')
    const session = expectedSession ?? this.sessionRevision
    return this.runExclusive(() => {
      if (session !== this.sessionRevision) throw new Error('Wallet session changed')
      this.accountService.assertTonConnectAccount(expectedAddress)
      return this.signingService.signData(domain, payload)
    })
  }

  private async signWithKeyUnlocked<T>(fn: (secretKey: Buffer) => T): Promise<T> {
    this.assertSigningReady()
    return this.withUnlockedKey(fn)
  }
  private async withUnlockedKey<T>(fn: (secretKey: Buffer) => T): Promise<T> {
    this.assertUnlocked()
    const session = this.sessionRevision
    if (!this.keypair || this.keyStorage.isLocked()) {
      this.keypair = await this.keyStorage.load()
    }
    this.assertUnlocked()
    if (session !== this.sessionRevision) throw new Error('Wallet session changed')
    return fn(this.keypair.secretKey)
  }
  async resolveDomain(domain: string): Promise<DnsResolveResult> {
    return this.queryService.resolveDomain(domain)
  }

  async resolveRecipient(input: string): Promise<{ address: string; domain?: string }> {
    return this.queryService.resolveRecipient(input)
  }

  private runExclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.operationTail.then(() => {
      if (this.closed) throw new Error('Wallet engine is shut down')
      return operation()
    })
    this.operationTail = result.then(
      () => {},
      () => {}
    )
    return result
  }

  private async unlockUnlocked(password: string): Promise<WalletState> {
    const session = this.sessionRevision
    const keypair = await this.keyStorage.load(password)
    if (session !== this.sessionRevision) {
      this.keyStorage.lock()
      throw new Error('Wallet session changed')
    }
    if (!this.publicKey || !keypair.publicKey.equals(this.publicKey)) throw new Error('Wallet identity mismatch')
    this.keypair = keypair
    this.invalidateSession()
    const unlockedSession = this.sessionRevision
    try {
      await this.openJournal()
      this.assertWalletSession(unlockedSession)
    } catch (error) {
      if (this.sessionRevision === unlockedSession) this.lock()
      throw error
    }
    const state = this.getState()
    this.publishState()
    return state
  }

  private assertSigningReady(): void {
    if (this.replacingWallet) throw new WalletEngineError('SEND_IN_PROGRESS', 'Wallet replacement is in progress', true)
    this.assertUnlocked()
    if (!this.backupVerified) throw new Error('Wallet backup verification required')
  }
  private assertUnlocked(): void {
    if (this.closed) throw new Error('Wallet engine is shut down')
    if (this.keyStorage.isLocked()) throw new Error('Wallet is locked')
    if (this.needsPasswordSetup) throw new Error('Wallet password setup required')
    if (!this.keypair || !this.walletContract) throw new Error('Wallet not initialized')
  }
  private assertSessionRevision(session: number): void {
    if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
    if (session !== this.sessionRevision) throw new WalletEngineError('IDENTITY_CHANGED', 'Wallet session changed')
  }
  private assertWalletSession(session: number): void {
    this.assertSessionRevision(session)
    this.assertUnlocked()
  }
  getIdentitySnapshot(): WalletIdentitySnapshot | null {
    return this.identity.snapshot(this.publicKey, this.walletContract?.address.toRawString() ?? null)
  }

  private assertWalletIdentity(expected: WalletIdentitySnapshot): void {
    this.identity.assertCurrent(this.getIdentitySnapshot(), expected)
  }
  withAutoLockPaused<T>(operation: () => Promise<T>): Promise<T> {
    return this.keyStorage.withAutoLockPaused(operation)
  }

  setPageOpen(open: boolean): void {
    this.keyStorage.setPageOpen(open)
  }

  setAutoLockMinutes(minutes: number): void {
    this.keyStorage.setAutoLockMinutes(minutes)
  }

  destroy(): void {
    this.closed = true
    this.queryService.clearRecipientCache()
    this.rejectSnapshotWaiters()
    this.runtime.stopSubscription()
    this.disposeBridgeChanged()
    this.disposeHistoryChanged()
    this.keyStorage.destroy()
    this.invalidateSession()
    this.journal.lock()
    this.backupVerifier.clear()
    this.stopRecovery()
    wipeKeypair(this.keypair)
    wipePublicKey(this.publicKey)
    this.keypair = null
    this.publicKey = null
    this.walletContract = null
    this.initialized = false
    this.publishState()
    this.log.info('Wallet manager destroyed')
  }

  private subscribeAccount(): void {
    const bridge = this.getBridge()
    if (!bridge || !this.walletContract) return
    const address = this.walletContract.address.toString()
    const identity = this.getIdentitySnapshot()
    const isCurrent = () => !this.closed && JSON.stringify(identity) === JSON.stringify(this.getIdentitySnapshot())
    this.runtime.startSubscription(bridge, address, {
      currentBalance: () => this.runtime.balance,
      accountObserved: () => {
        this.balanceGeneration++
      },
      balanceChanged: (balance) => {
        this.runtime.setBalance(balance)
        this.publishSnapshot()
        this.emit('balance-updated', balance)
      },
      convertTransaction: (transaction) => this.queryService.convertRawTransaction(transaction),
      transactionReceived: (transaction) => {
        void this.options.history
          .reconcile([transaction], isCurrent)
          .then((history) => {
            if (isCurrent())
              this.emit(
                'new-transaction',
                history.find(
                  (item) => item.id === transaction.id || Boolean(item.hash && item.hash === transaction.hash)
                ) ?? transaction
              )
          })
          .catch(() => undefined)
        void this.resolvePending().catch(() => undefined)
      },
      refreshBalance: () => this.getBalance(),
      refreshFailed: (error) => this.log.debug('Balance refresh after tx push failed:', error),
    })
  }

  private unsubscribeAccount(): void {
    this.runtime.stopSubscription()
  }

  private async refreshBridgeState(): Promise<void> {
    await Promise.allSettled([
      warmupWalletBridge(() => this.getBalance()).then((ready) => {
        if (!ready) this.log.warn('Liteserver pool warmup: shard did not respond, proceeding with cached balance')
      }),
      this.resolvePending(),
    ])
  }

  private invalidateSession(): void {
    this.sessionRevision++
    const previous = this.sessionAbort
    this.sessionAbort = new AbortController()
    previous.abort()
  }
  getSessionRevision(): number {
    return this.sessionRevision
  }
  snapshot(): WalletSnapshot {
    if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
    return this.publishedSnapshot
  }
  async waitForChange(afterRevision: number): Promise<WalletSnapshot> {
    if (this.closed) throw new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down')
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0)
      throw new WalletEngineError('INVALID_REVISION', 'Invalid wallet snapshot revision')
    if (this.publishedSnapshot.revision <= afterRevision)
      await new Promise<void>((resolve, reject) => this.snapshotWaiters.add({ after: afterRevision, resolve, reject }))
    return this.snapshot()
  }
  private rejectSnapshotWaiters(): void {
    for (const waiter of this.snapshotWaiters)
      waiter.reject(new WalletEngineError('SHUTDOWN', 'Wallet engine is shut down'))
    this.snapshotWaiters.clear()
  }
  private publishState(): void {
    this.publishSnapshot()
    this.emit('state-changed', this.getState())
  }
  private publishSnapshot(): void {
    if (this.closed || !this.publishedSnapshot) return
    const value = {
      ...this.getState(),
      sessionRevision: this.sessionRevision,
      operations: this.journal.list(),
      transactions: this.walletContract && this.historyVisible ? this.options.history.snapshot() : [],
    }
    const fingerprint = JSON.stringify(value)
    if (fingerprint === this.snapshotFingerprint) return
    const revision = this.publishedSnapshot.revision + 1
    if (!Number.isSafeInteger(revision))
      throw new WalletEngineError('REVISION_EXHAUSTED', 'Wallet snapshot revision exhausted')
    this.snapshotFingerprint = fingerprint
    this.publishedSnapshot = freezeSnapshot({ ...value, revision })
    for (const waiter of this.snapshotWaiters) {
      if (revision > waiter.after) {
        this.snapshotWaiters.delete(waiter)
        waiter.resolve()
      }
    }
    this.emit('snapshot-changed', this.publishedSnapshot)
  }
  shutdown(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask
    // Share the drain before abort callbacks can re-enter shutdown. An engaged
    // vault write (including rollback) must settle before the profile is released.
    this.shutdownTask = Promise.resolve().then(async () => {
      try {
        await this.operationTail
        await this.journal.flush()
      } finally {
        this.destroy()
      }
    })
    this.closed = true
    this.rejectSnapshotWaiters()
    this.invalidateSession()
    this.stopRecovery()
    return this.shutdownTask
  }
  private publishOperation(operation: WalletOperation): void {
    this.publishState()
    this.emit('operation-changed', operation)
    if (operation.messages.length) {
      const identity = this.getIdentitySnapshot()
      const isCurrent = () => !this.closed && JSON.stringify(identity) === JSON.stringify(this.getIdentitySnapshot())
      const tx = this.operationTransaction(operation)
      void this.options.history
        .reconcile([tx], isCurrent)
        .then(
          (history) =>
            isCurrent() &&
            this.emit(
              'new-transaction',
              history.find(
                (item) =>
                  item.operationId === operation.id || item.id === tx.id || Boolean(item.hash && item.hash === tx.hash)
              ) ?? tx
            )
        )
        .catch(() => undefined)
    }
  }
  private stopRecovery(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer)
    this.recoveryTimer = null
  }
  private async openJournal(): Promise<void> {
    this.assertUnlocked()
    const session = this.sessionRevision
    const journal = this.journal
    const address = this.walletContract!.address.toRawString()
    await journal.open(this.keypair!.secretKey, `mainnet:${address}`)
    this.assertWalletSession(session)
    await this.importLegacyPending(journal, address)
    this.startRecovery(session)
  }
  private startRecovery(session: number): void {
    const assertCurrent = () => {
      this.assertWalletSession(session)
      if (!this.journal.isOpen()) throw new WalletEngineError('JOURNAL_LOCKED', 'Operation journal is locked')
    }
    assertCurrent()
    this.publishSnapshot()
    assertCurrent()
    this.emit('journal-opened', this.journal.list())
    assertCurrent()
    const pending = this.journal.pending()
    if (pending) this.publishOperation(pending)
    assertCurrent()
    this.stopRecovery()
    this.recoveryTimer = setInterval(() => {
      void this.resolvePending().catch(() => undefined)
    }, 30_000)
    this.recoveryTimer.unref?.()
    void this.resolvePending().catch(() => undefined)
  }
  private async importLegacyPending(journal: OperationJournal, address: string): Promise<void> {
    const lease = (await this.options.legacyPending?.())?.[address]
    if (!lease) return
    const id = `legacy:${lease.seqno}:${lease.validUntil}`
    if (journal.get(id)) return
    await journal.save({
      id,
      intentHash: '',
      account: `mainnet:${address}`,
      phase: 'legacy-pending',
      seqno: lease.seqno,
      validUntil: lease.validUntil,
      baselineLt: '0',
      baselineHash: '',
      startedAt: 0,
      messages: [],
      estimatedFee: '0',
      closed: false,
    })
  }
  resolvePending(): Promise<void> {
    return this.transfers.resolvePending()
  }
  previewTransfer(intent: TransferIntent) {
    return this.transfers.previewTransfer(intent)
  }
  sendTransfer(intent: TransferIntent, authorize?: TransferAuthorization) {
    return this.transfers.sendTransfer(intent, authorize)
  }
  signForRelay(intent: TransferIntent, authorize?: TransferAuthorization) {
    return this.transfers.signForRelay(intent, authorize)
  }
  async retryOperation(id: string, authorize: TransferAuthorization): Promise<WalletTransaction> {
    const operation = await this.transfers.retryOperation(id, authorize)
    const transaction = this.operationTransaction(operation)
    await this.options.history.reconcile([transaction])
    return transaction
  }
  async sendNative(
    input: { to: string; amount: string; comment?: string; encrypted?: boolean; operationId: string },
    authorize: (
      review: import('./transactions').TransferReview & { domain?: string; comment?: string; commentEncrypted: boolean }
    ) => Promise<{
      action: 'approve' | 'cancel' | 'set-memo' | 'set-encryption'
      comment?: string
      encrypted?: boolean
    }>
  ): Promise<WalletTransaction> {
    this.assertSigningReady()
    if (!/^\d+$/.test(input.amount) || BigInt(input.amount) <= 0n) throw new Error('Invalid transfer amount')
    const session = this.sessionRevision
    const identity = this.getIdentitySnapshot()!
    const requestHash = intentFingerprint([input.to, input.amount, input.comment ?? null, input.encrypted ?? false])
    const prior = this.journal.get(input.operationId)
    if (prior) {
      if (prior.requestHash !== requestHash) throw new Error('Operation content changed')
      if (['ready', 'submitting', 'unknown', 'seqno-consumed'].includes(prior.phase))
        throw new WalletEngineError(
          'TRANSACTION_PENDING',
          'Transfer status is uncertain. Check its history before retrying.',
          true
        )
      return this.operationTransaction(prior)
    }
    const recipient = await this.resolveRecipient(input.to)
    this.assertWalletIdentity(identity)
    if (session !== this.sessionRevision) throw new Error('Wallet session changed')
    let comment = input.comment
    let encrypted = Boolean(input.encrypted && comment)
    for (;;) {
      let changed: Awaited<ReturnType<typeof authorize>> | null = null
      const body =
        encrypted && comment ? await this.prepareEncryptedComment(recipient.address, comment, identity) : undefined
      if (session !== this.sessionRevision) throw new Error('Wallet session changed')
      const message = createTonTransferMessage(recipient.address, input.amount, comment, body).message
      try {
        const operation = await this.transfers.sendTransfer(
          {
            operationId: input.operationId,
            requestHash,
            comment,
            commentEncrypted: encrypted,
            messages: [
              {
                address: recipient.address,
                amount: input.amount,
                payload: message.body?.toBoc().toString('base64'),
                bounce: message.info.type === 'internal' && message.info.bounce,
              },
            ],
          },
          async (review) => {
            const decision = await authorize({
              ...review,
              domain: recipient.domain,
              comment,
              commentEncrypted: encrypted,
            })
            if (decision.action === 'set-memo' || decision.action === 'set-encryption') {
              changed = decision
              throw new Error('REVIEW_EDIT')
            }
            return decision.action === 'approve'
          },
          false
        )
        this.assertWalletSession(session)
        this.assertWalletIdentity(identity)
        const current = this.journal.get(operation.id) ?? operation
        if (['ready', 'submitting', 'unknown', 'seqno-consumed'].includes(current.phase))
          throw new WalletEngineError(
            'TRANSACTION_PENDING',
            'Transfer status is uncertain. Check its history before retrying.',
            true
          )
        const tx = this.operationTransaction(current)
        return tx
      } catch (error) {
        if (!changed) throw error
        this.assertWalletIdentity(identity)
        if (session !== this.sessionRevision) throw new Error('Wallet session changed')
        const decision = changed as { action: string; comment?: string; encrypted?: boolean }
        if (decision.action === 'set-memo') {
          comment = decision.comment
          if (!comment) encrypted = false
        } else encrypted = Boolean(decision.encrypted && comment)
      }
    }
  }

  private operationTransaction(op: WalletOperation): WalletTransaction {
    return {
      id: op.id,
      type: op.context === 'x402' ? 'x402' : 'send',
      amount: op.messages[0]?.amount ?? '0',
      address: op.messages[0]?.address ?? '',
      timestamp: op.startedAt,
      status:
        op.phase === 'included'
          ? op.execution === 'succeeded'
            ? 'confirmed'
            : op.execution === 'failed'
              ? 'failed'
              : 'pending'
          : op.phase === 'expired'
            ? 'failed'
            : 'pending',
      hash: op.transactionHash,
      lt: op.transactionLt,
      comment: op.comment,
      commentEncrypted: op.commentEncrypted,
      operationId: op.id,
      operationState: op.phase,
      execution: op.execution,
    }
  }
  async waitForOperation(id: string, timeoutMs = 120_000): Promise<WalletOperation | undefined> {
    await this.resolvePending()
    const current = this.journal.get(id)
    if (!current || current.closed) return current
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        this.off('operation-changed', onChange)
        this.off('state-changed', onState)
        resolve(this.journal.get(id))
      }
      const onChange = (operation: WalletOperation) => {
        if (operation.id === id && operation.closed) finish()
      }
      const onState = () => {
        if (!this.journal.isOpen() || this.closed) finish()
      }
      const timer = setTimeout(finish, timeoutMs)
      timer.unref?.()
      this.on('operation-changed', onChange)
      this.on('state-changed', onState)
      const latest = this.journal.get(id)
      if (latest?.closed || !this.journal.isOpen()) finish()
    })
  }
  getOperation(id: string) {
    return this.journal.get(id)
  }
  async getHistory(limit = WALLET_HISTORY_DEFAULT_LIMIT): Promise<WalletTransaction[]> {
    const identity = this.getIdentitySnapshot()
    const generation = ++this.historyGeneration
    const isCurrent = () =>
      !this.closed &&
      generation === this.historyGeneration &&
      JSON.stringify(this.getIdentitySnapshot()) === JSON.stringify(identity)
    const reconcile = (history: WalletTransaction[]) =>
      this.options.history.reconcile(
        [
          ...history,
          ...this.journal
            .list()
            .filter((operation) => operation.messages.length)
            .map((operation) => this.operationTransaction(operation)),
        ],
        isCurrent
      )
    try {
      if (!this.historyVisible) {
        await this.options.history.clear()
        if (!isCurrent()) throw new WalletEngineError('SUPERSEDED', 'Wallet history request was superseded')
        this.historyVisible = true
      }
      if (this.journal.isOpen()) await this.resolvePending().catch(() => undefined)
      const history = await this.fetchOnChainHistory(limit)
      if (!isCurrent()) throw new WalletEngineError('SUPERSEDED', 'Wallet history request was superseded')
      return await reconcile(history)
    } catch (error) {
      if (!isCurrent()) throw new WalletEngineError('SUPERSEDED', 'Wallet history request was superseded')
      if (!this.historyVisible) throw error
      if (this.options.fallbackHistory && this.walletContract) {
        try {
          const history = await this.options.fallbackHistory(this.walletContract.address.toString(), limit)
          if (!isCurrent()) throw new WalletEngineError('SUPERSEDED', 'Wallet history request was superseded')
          if (history.length) return await reconcile(history)
        } catch {
          /* preserve the validated local cache */
        }
      }
      const cached = await this.options.history.getAll()
      if (!isCurrent()) throw new WalletEngineError('SUPERSEDED', 'Wallet history request was superseded')
      if (cached.length) return cached
      throw error
    }
  }
  async clearHistory(): Promise<void> {
    this.historyGeneration++
    await this.options.history.clear()
  }
  private async resetVisibleHistory(): Promise<void> {
    this.historyVisible = false
    this.historyGeneration++
    try {
      await this.options.history.clear()
      this.historyVisible = true
    } catch {
      this.log.warn('Wallet history is unavailable for the current account')
    }
  }
  async decryptComment(request: DecryptCommentRequest): Promise<string> {
    this.assertUnlocked()
    const session = this.sessionRevision
    const identity = this.getIdentitySnapshot()!
    try {
      validateEncryptedCommentBody(request.body)
      const comment = await this.withUnlockedKey((secret) => decryptEncryptedComment(request, secret))
      this.assertUnlocked()
      this.assertWalletIdentity(identity)
      if (session !== this.sessionRevision) throw new Error('Wallet session changed')
      return comment
    } catch {
      throw new WalletEngineError(
        'ENCRYPTED_COMMENT_UNAVAILABLE',
        'Unable to decrypt this comment in the current wallet session'
      )
    }
  }
  async prepareEncryptedComment(to: string, comment: string, identity: WalletIdentitySnapshot): Promise<Cell> {
    this.assertWalletIdentity(identity)
    const session = this.sessionRevision
    const result = await this.getBridge()!.runMethod(
      Address.parse(to).toString({ bounceable: false }),
      'get_public_key'
    )
    this.assertWalletIdentity(identity)
    if (session !== this.sessionRevision) throw new Error('Wallet session changed')
    return this.signWithKeyUnlocked((secretKey) =>
      createEncryptedCommentBody({
        senderAddress: this.walletContract!.address,
        senderSecretKey: secretKey,
        recipientPublicKey: parseRecipientPublicKey(result),
        comment,
      })
    )
  }
  async preflightTransfer(
    to: string,
    amount: string,
    comment: string | undefined,
    identity: WalletIdentitySnapshot,
    body?: Cell
  ) {
    this.assertWalletIdentity(identity)
    const message = createTonTransferMessage(to, amount, comment, body).message
    const preview = await this.previewTransfer({
      operationId: randomUUID(),
      messages: [
        {
          address: to,
          amount,
          payload: message.body?.toBoc().toString('base64'),
          bounce: message.info.type === 'internal' && message.info.bounce,
        },
      ],
    })
    return { estimatedFee: preview.estimatedFee, walletBalance: preview.walletBalance, destinationStatus: 'active' }
  }
  async send(
    to: string,
    amount: string,
    comment?: string,
    identity?: WalletIdentitySnapshot,
    body?: Cell,
    encrypted = false,
    operationId: string = randomUUID()
  ): Promise<WalletTransaction> {
    if (identity) this.assertWalletIdentity(identity)
    const message = createTonTransferMessage(to, amount, comment, body).message
    const op = await this.sendTransfer(
      {
        operationId,
        comment,
        commentEncrypted: encrypted || undefined,
        messages: [
          {
            address: to,
            amount,
            payload: message.body?.toBoc().toString('base64'),
            bounce: message.info.type === 'internal' && message.info.bounce,
          },
        ],
      },
      async () => true
    )
    return this.operationTransaction(op)
  }

  private getBridge(): WalletBridgePort | null {
    return this.closed ? null : this.bridgeProvider.getBridge()
  }
}
