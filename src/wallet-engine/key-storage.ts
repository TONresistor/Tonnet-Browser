import { errorMessage } from './errors'
import type { VaultPersistence, SecureStorage } from './ports'
import { keyPairFromSeed, mnemonicNew } from '@ton/crypto'
import { AUTO_LOCK_DEFAULT_MS } from './constants'

import { createLogger, type WalletLogger } from './logger'
const isEnoent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

import { decryptWalletSecret, encryptWalletSecret, type PasswordEnvelope, type WalletSecret } from './password-vault'
import { deriveWalletKeyPair, validateTonMnemonic, type MnemonicScheme, type WalletVersion } from './wallet-versions'
import { createDeviceEnvelope, encodeStorageData, parseStorageData, type StorageData } from './wallet-storage-format'

const ENCRYPTED_MARKER = Buffer.from('SENC')
export class WalletDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletDecryptionError'
  }
}

export class WalletSystemStorageError extends WalletDecryptionError {
  constructor(message: string) {
    super(message)
    this.name = 'WalletSystemStorageError'
  }
}

export class WalletKeyStorage {
  private storage: SecureStorage
  private filePath: string
  private cachedPublicKey: Buffer | null = null
  private cachedSecretKey: Buffer | null = null
  private lockTimer: ReturnType<typeof setTimeout> | null = null
  private activeOperations = 0
  private openPageTimer: ReturnType<typeof setTimeout> | null = null
  private autoLockMs: number = AUTO_LOCK_DEFAULT_MS
  private onLock: (() => void) | null = null
  private passwordProtected = false
  private lockGeneration = 0

  constructor(
    storage: SecureStorage,
    private readonly persistence: VaultPersistence,
    private readonly log: WalletLogger = createLogger('wallet:keys')
  ) {
    this.storage = storage
    this.filePath = persistence.filePath
  }

  get bakPath(): string {
    return `${this.filePath}.pre-migration.bak`
  }

  get passwordBakPath(): string {
    return `${this.filePath}.pre-password.bak`
  }

  get importBakPath(): string {
    return `${this.filePath}.pre-import.bak`
  }

  isBasicTextBackend(): boolean {
    try {
      const backend = this.storage.getBackendName()
      return backend === 'basic_text'
    } catch {
      return false
    }
  }

  private ensureEncryptionAvailable(): void {
    if (!this.storage.isAvailable()) {
      throw new Error('Secure storage is not available. Install a keyring (gnome-keyring, kwallet) to use the wallet.')
    }
  }

  async generateFromMnemonic(password?: string): Promise<{
    keypair: { publicKey: Buffer; secretKey: Buffer }
    mnemonic: string[]
  }> {
    const generation = this.lockGeneration
    if (await this.exists()) {
      throw new Error('Wallet already exists')
    }
    this.ensureEncryptionAvailable()
    if (this.isBasicTextBackend() && !password) {
      throw new Error('An application password is required because secure system storage is unavailable')
    }
    const mnemonic = await mnemonicNew(24)
    const keypair = await deriveWalletKeyPair(mnemonic)
    const secret: WalletSecret = { type: 'mnemonic', mnemonic }
    const expectedPublicKey = Buffer.from(keypair.publicKey)
    try {
      const data = password
        ? await encryptWalletSecret(secret, password, keypair.publicKey, false, 'v5R1', 'ton')
        : createDeviceEnvelope(secret, keypair.publicKey, false, 'v5R1', 'ton')
      this.assertGeneration(generation)
      await this.storeData(data)
      this.assertGeneration(generation)
      keypair.publicKey.fill(0)
      keypair.secretKey.fill(0)
      this.passwordProtected = Boolean(password)
      const persistedKeypair = await this.load(password)
      if (!persistedKeypair.publicKey.equals(expectedPublicKey)) {
        throw new WalletDecryptionError('Persisted wallet identity mismatch')
      }
      this.log.info('Generated and verified new mnemonic-based wallet keypair')
      return { keypair: persistedKeypair, mnemonic }
    } catch (error) {
      keypair.publicKey.fill(0)
      keypair.secretKey.fill(0)
      mnemonic.fill('')
      this.lock()
      this.cachedPublicKey?.fill(0)
      this.cachedPublicKey = null
      await this.persistence.files.unlink(this.filePath).catch(() => undefined)
      throw error
    } finally {
      expectedPublicKey.fill(0)
    }
  }

  async importFromMnemonic(
    words: string[],
    password?: string,
    walletVersion: WalletVersion = 'v5R1'
  ): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    const generation = this.lockGeneration
    this.ensureEncryptionAvailable()
    if (!(await validateTonMnemonic(words))) {
      throw new Error('Invalid mnemonic phrase')
    }
    if (this.isBasicTextBackend() && !password) {
      throw new Error('An application password is required because secure system storage is unavailable')
    }
    const keypair = await deriveWalletKeyPair(words)
    let replacing = false
    let writeAttempted = false
    try {
      const secret: WalletSecret = { type: 'mnemonic', mnemonic: words }
      const data = password
        ? await encryptWalletSecret(secret, password, keypair.publicKey, true, walletVersion, 'ton')
        : createDeviceEnvelope(secret, keypair.publicKey, true, walletVersion, 'ton')
      replacing = await this.exists()
      if (replacing) {
        await this.persistence.files.copyFile(this.filePath, this.importBakPath)
        if (process.platform !== 'win32') await this.persistence.files.chmod(this.importBakPath, 0o600)
      }
      this.assertGeneration(generation)
      writeAttempted = true
      await this.storeData(data)
      this.assertGeneration(generation)
      this.passwordProtected = Boolean(password)
      this.cachedPublicKey = keypair.publicKey
      this.cachedSecretKey = keypair.secretKey
      this.resetLockTimer()
      this.log.info('Imported wallet from mnemonic')
      return keypair
    } catch (error) {
      keypair.secretKey.fill(0)
      keypair.publicKey.fill(0)
      if (writeAttempted && replacing) {
        try {
          const previous = await this.persistence.files.readFile(this.importBakPath)
          await this.persistence.writeAtomic(this.filePath, previous)
        } catch {
          this.lock()
          throw new WalletDecryptionError('Wallet import failed; encrypted recovery backup preserved')
        }
      } else if (writeAttempted) {
        await this.persistence.files.unlink(this.filePath).catch(() => undefined)
      }
      throw error
    }
  }

  async getMnemonic(password?: string): Promise<{ mnemonic: string[] } | null> {
    const stored = await this.readData()
    const data =
      stored?.type === 'password'
        ? await this.decryptEnvelope(stored, password)
        : stored?.type === 'device'
          ? stored.secret
          : stored
    if (!data) {
      throw new Error('No wallet data found')
    }
    if (data.type === 'mnemonic') {
      return { mnemonic: data.mnemonic }
    }
    return null
  }

  async load(password?: string): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    const generation = this.lockGeneration
    if (this.cachedPublicKey && this.cachedSecretKey) {
      return { publicKey: this.cachedPublicKey, secretKey: this.cachedSecretKey }
    }

    const stored = await this.readData()
    if (!stored) {
      throw new Error('No wallet data found')
    }
    this.passwordProtected = stored.type === 'password'
    const data =
      stored.type === 'password'
        ? await this.decryptEnvelope(stored, password)
        : stored.type === 'device'
          ? stored.secret
          : stored
    if (stored.type === 'password') await this.persistence.files.unlink(this.passwordBakPath).catch(() => undefined)

    let keypair: { publicKey: Buffer; secretKey: Buffer }
    if (data.type === 'mnemonic') {
      keypair = await deriveWalletKeyPair(data.mnemonic)
    } else {
      const seed = Buffer.from(data.seed, 'hex')
      keypair = keyPairFromSeed(seed)
      seed.fill(0)
    }
    if (stored.type === 'device' && !keypair.publicKey.equals(Buffer.from(stored.publicKey, 'hex'))) {
      keypair.publicKey.fill(0)
      keypair.secretKey.fill(0)
      throw new WalletDecryptionError('Device wallet identity mismatch')
    }

    if (generation !== this.lockGeneration) {
      keypair.publicKey.fill(0)
      keypair.secretKey.fill(0)
      throw new WalletDecryptionError('Wallet locked during key access')
    }
    this.cachedPublicKey = keypair.publicKey
    this.cachedSecretKey = keypair.secretKey
    this.resetLockTimer()
    return { publicKey: this.cachedPublicKey!, secretKey: this.cachedSecretKey! }
  }

  async inspect(): Promise<{
    publicKey: Buffer | null
    passwordProtected: boolean
    backupVerified: boolean
    walletVersion: WalletVersion
    mnemonicScheme: MnemonicScheme
  } | null> {
    const data = await this.readData()
    if (!data) return null
    if (data.type === 'password') {
      this.passwordProtected = true
      const publicKey = Buffer.from(data.publicKey, 'hex')
      this.cachedPublicKey = Buffer.from(publicKey)
      return {
        publicKey,
        passwordProtected: true,
        backupVerified: data.backupVerified,
        walletVersion: data.walletVersion,
        mnemonicScheme: data.mnemonicScheme,
      }
    }
    if (data.type === 'device') {
      const publicKey = Buffer.from(data.publicKey, 'hex')
      this.passwordProtected = false
      this.cachedPublicKey = Buffer.from(publicKey)
      return {
        publicKey,
        passwordProtected: false,
        backupVerified: data.backupVerified,
        walletVersion: data.walletVersion,
        mnemonicScheme: data.mnemonicScheme,
      }
    }
    this.passwordProtected = false
    return {
      publicKey: null,
      passwordProtected: false,
      backupVerified: data.type === 'seed',
      walletVersion: 'v5R1',
      mnemonicScheme: 'ton',
    }
  }

  async protectWithPassword(password: string): Promise<void> {
    const stored = await this.readData()
    if (!stored) throw new Error('No wallet data found')
    if (stored.type === 'password') throw new Error('Wallet is already password protected')
    const keypair = await this.load()
    const secret = stored.type === 'device' ? stored.secret : stored
    const backupVerified = stored.type === 'device' ? stored.backupVerified : true
    const walletVersion = stored.type === 'device' ? stored.walletVersion : 'v5R1'
    const mnemonicScheme = stored.type === 'device' ? stored.mnemonicScheme : 'ton'
    const envelope = await encryptWalletSecret(
      secret,
      password,
      keypair.publicKey,
      backupVerified,
      walletVersion,
      mnemonicScheme
    )
    await this.persistence.files.copyFile(this.filePath, this.passwordBakPath)
    if (process.platform !== 'win32') await this.persistence.files.chmod(this.passwordBakPath, 0o600)
    try {
      await this.storeData(envelope)
      const verified = await this.readData()
      if (!verified || verified.type !== 'password') throw new Error('Password vault verification failed')
      await this.decryptEnvelope(verified, password)
      await this.persistence.files.unlink(this.passwordBakPath)
      this.passwordProtected = true
    } catch (error) {
      await this.persistence.files.copyFile(this.passwordBakPath, this.filePath).catch(() => undefined)
      throw error
    }
  }

  async markBackupVerified(password?: string): Promise<void> {
    const stored = await this.readData()
    if (!stored) throw new Error('No wallet data found')
    if (stored.type === 'password') {
      if (!password) throw new Error('Wallet password required')
      const secret = await decryptWalletSecret(stored, password)
      await this.storeData(
        await encryptWalletSecret(
          secret,
          password,
          Buffer.from(stored.publicKey, 'hex'),
          true,
          stored.walletVersion,
          stored.mnemonicScheme
        )
      )
      return
    }
    if (stored.type === 'device') {
      await this.storeData({ ...stored, backupVerified: true })
      return
    }
    const keypair = await this.load()
    await this.storeData(createDeviceEnvelope(stored, keypair.publicKey, true, 'v5R1', 'ton'))
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<void> {
    const stored = await this.readData()
    if (!stored || stored.type !== 'password') throw new Error('Password-protected wallet required')
    const secret = await decryptWalletSecret(stored, currentPassword)
    const envelope = await encryptWalletSecret(
      secret,
      nextPassword,
      Buffer.from(stored.publicKey, 'hex'),
      stored.backupVerified,
      stored.walletVersion,
      stored.mnemonicScheme
    )
    await this.persistence.files.copyFile(this.filePath, this.passwordBakPath)
    if (process.platform !== 'win32') await this.persistence.files.chmod(this.passwordBakPath, 0o600)
    try {
      await this.storeData(envelope)
      await decryptWalletSecret(envelope, nextPassword)
      await this.persistence.files.unlink(this.passwordBakPath)
    } catch (error) {
      await this.persistence.files.copyFile(this.passwordBakPath, this.filePath).catch(() => undefined)
      throw error
    }
  }

  async authenticatePassword(password: string): Promise<void> {
    const stored = await this.readData()
    if (!stored || stored.type !== 'password') {
      throw new WalletDecryptionError('Password-protected wallet required')
    }
    const secret = await this.decryptEnvelope(stored, password)
    if (secret.type === 'mnemonic') secret.mnemonic.fill('')
    else secret.seed = ''
  }

  private async decryptEnvelope(envelope: PasswordEnvelope, password?: string): Promise<WalletSecret> {
    if (!password) throw new WalletDecryptionError('Wallet is locked')
    try {
      const secret = await decryptWalletSecret(envelope, password)
      const keypair =
        secret.type === 'mnemonic'
          ? await deriveWalletKeyPair(secret.mnemonic)
          : keyPairFromSeed(Buffer.from(secret.seed, 'hex'))
      if (!keypair.publicKey.equals(Buffer.from(envelope.publicKey, 'hex'))) {
        keypair.publicKey.fill(0)
        keypair.secretKey.fill(0)
        throw new Error('Wallet public key mismatch')
      }
      keypair.publicKey.fill(0)
      keypair.secretKey.fill(0)
      return secret
    } catch (error) {
      if (error instanceof WalletDecryptionError) throw error
      throw new WalletDecryptionError('Invalid wallet password or corrupted vault')
    }
  }
  async exists(): Promise<boolean> {
    try {
      await this.persistence.files.access(this.filePath)
      return true
    } catch (error) {
      if (isEnoent(error)) return false
      throw new WalletSystemStorageError('Wallet storage is unavailable')
    }
  }
  setAutoLockMinutes(minutes: number): void {
    this.autoLockMs = minutes * 60 * 1000
    if (this.cachedSecretKey && this.autoLockMs > 0) {
      this.resetLockTimer()
    }
    if (this.autoLockMs === 0 && this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
  }
  async withAutoLockPaused<T>(operation: () => Promise<T>): Promise<T> {
    this.activeOperations++
    if (this.lockTimer) clearTimeout(this.lockTimer)
    this.lockTimer = null
    try {
      return await operation()
    } finally {
      this.activeOperations--
      if (this.activeOperations === 0 && this.cachedSecretKey) this.resetLockTimer()
    }
  }
  setPageOpen(open: boolean): void {
    if (this.openPageTimer) clearTimeout(this.openPageTimer)
    this.openPageTimer = null
    if (open) {
      // A crashed renderer must not leave automatic locking suspended indefinitely.
      this.openPageTimer = setTimeout(() => this.setPageOpen(false), 60_000)
      if (this.lockTimer) clearTimeout(this.lockTimer)
      this.lockTimer = null
    } else if (this.cachedSecretKey) {
      this.resetLockTimer()
    }
  }
  setOnLock(listener: (() => void) | null): void {
    this.onLock = listener
  }
  private assertGeneration(generation: number): void {
    if (generation !== this.lockGeneration) throw new WalletDecryptionError('Wallet locked during key access')
  }
  lock(): void {
    this.lockGeneration++
    const wasUnlocked = this.cachedSecretKey !== null
    if (this.cachedSecretKey) {
      this.cachedSecretKey.fill(0)
      this.cachedSecretKey = null
      this.log.info('Wallet locked: secret key cleared from memory')
    }
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
    if (wasUnlocked) this.onLock?.()
  }
  isLocked(): boolean {
    return this.passwordProtected && this.cachedPublicKey !== null && this.cachedSecretKey === null
  }
  getPublicKey(): Buffer | null {
    return this.cachedPublicKey
  }
  destroy(): void {
    if (this.openPageTimer) clearTimeout(this.openPageTimer)
    this.openPageTimer = null
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
    if (this.cachedSecretKey) {
      this.cachedSecretKey.fill(0)
      this.cachedSecretKey = null
    }
    if (this.cachedPublicKey) {
      this.cachedPublicKey.fill(0)
      this.cachedPublicKey = null
    }
  }
  async deleteFile(): Promise<void> {
    await this.persistence.delete([
      this.filePath,
      this.bakPath,
      this.passwordBakPath,
      this.importBakPath,
      `${this.filePath}.tmp`,
    ])
  }
  async getStorageFingerprint(): Promise<string | null> {
    return this.persistence.fingerprint(this.filePath)
  }
  async quarantine(expectedFingerprint: string): Promise<{ recoveryId: string }> {
    const candidates = [this.filePath, this.bakPath, this.passwordBakPath, this.importBakPath, `${this.filePath}.tmp`]
    return this.persistence.quarantine(this.filePath, candidates, expectedFingerprint)
  }
  private resetLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
    }
    if (this.autoLockMs > 0 && !this.openPageTimer && this.activeOperations === 0) {
      this.lockTimer = setTimeout(() => this.lock(), this.autoLockMs)
    }
  }
  private async migrateRawSeedSafe(seedHex: string): Promise<void> {
    const bak = this.bakPath
    const tmp = `${this.filePath}.tmp`

    // --- 0. Handle stale backup from a previously interrupted migration ---
    let bakExists = false
    try {
      await this.persistence.files.access(bak, 0)
      bakExists = true
    } catch {
      /* no bak — first run */
    }

    if (bakExists) {
      // A previous migration was interrupted.  Check whether the main file is
      // already valid (crash happened after write but before bak cleanup).
      const mainOk = await this.verifySeedFile(seedHex)
      if (mainOk) {
        // Migration succeeded earlier; just clean up the leftover backup.
        try {
          await this.persistence.files.unlink(bak)
          this.log.info('Removed stale migration backup after verifying main file is valid')
        } catch (err) {
          this.log.warn('Could not remove stale migration backup:', err)
        }
        return
      }
      // Main file is not valid — previous migration failed mid-write.
      // Restore from backup so the user's seed is intact, then retry.
      this.log.warn('Detected interrupted migration; restoring from backup and retrying')
      try {
        await this.persistence.files.copyFile(bak, this.filePath)
        if (process.platform !== 'win32') await this.persistence.files.chmod(this.filePath, 0o600)
      } catch (restoreErr) {
        this.log.error('Failed to restore from backup; leaving backup in place:', restoreErr)
        throw new WalletDecryptionError('Legacy wallet migration restore failed')
      }
    }

    try {
      // --- 1. Create backup of the original raw-seed file ---
      await this.persistence.files.copyFile(this.filePath, bak)
      if (process.platform !== 'win32') await this.persistence.files.chmod(bak, 0o600)

      // --- 2. Write new encrypted file atomically (tmp → rename) ---
      const data: WalletSecret = { type: 'seed', seed: seedHex }
      const json = encodeStorageData(data)
      const encrypted = this.storage.encrypt(json)
      const markedBuffer = Buffer.concat([ENCRYPTED_MARKER, encrypted])
      await this.persistence.files.writeFile(tmp, markedBuffer, { mode: 0o600 })
      await this.persistence.files.rename(tmp, this.filePath)

      // --- 3. Verify the new file is readable and decrypts correctly ---
      const verified = await this.verifySeedFile(seedHex)
      if (!verified) {
        throw new Error('Post-migration verification failed: decrypted seed does not match original')
      }

      // --- 4. Remove backup only after successful verification ---
      await this.persistence.files.unlink(bak)
      this.log.info('Migrated legacy unencrypted seed to encrypted format')
    } catch (err) {
      this.log.error('Failed to migrate legacy seed (backup preserved at', bak, '):', err)
      await this.persistence.files.unlink(tmp).catch(() => undefined)
      try {
        await this.persistence.files.copyFile(bak, this.filePath)
        if (process.platform !== 'win32') await this.persistence.files.chmod(this.filePath, 0o600)
        const restored = await this.persistence.files.readFile(this.filePath)
        if (restored.length !== 32 || restored.toString('hex') !== seedHex) throw new Error('Restored seed mismatch')
      } catch (restoreError) {
        this.log.error('Failed to restore raw seed after migration error:', restoreError)
        throw new WalletDecryptionError('Legacy wallet migration failed and restore could not be verified')
      }
      throw new WalletDecryptionError('Legacy wallet migration failed; raw backup preserved')
    }
  }

  /**
   * Read the wallet file and verify that it decrypts to the expected seedHex.
   * Returns true if the file is valid and the seed matches.
   */
  private async verifySeedFile(expectedSeedHex: string): Promise<boolean> {
    try {
      const buf = await this.persistence.files.readFile(this.filePath)
      if (!buf.subarray(0, 4).equals(ENCRYPTED_MARKER)) return false
      const decrypted = this.storage.decrypt(buf.subarray(4))
      if (decrypted.startsWith('{')) {
        const parsed = parseStorageData(JSON.parse(decrypted))
        return parsed.type === 'seed' && parsed.seed === expectedSeedHex
      }
      // Legacy encrypted hex path — shouldn't occur here but handle defensively
      return decrypted === expectedSeedHex
    } catch {
      return false
    }
  }

  private async storeData(data: StorageData): Promise<void> {
    this.ensureEncryptionAvailable()
    const json = encodeStorageData(data)
    const encrypted = this.storage.encrypt(json)
    const markedBuffer = Buffer.concat([ENCRYPTED_MARKER, encrypted])
    // Atomic + fsync write (tmp -> rename, 0o600): a crash mid-write must never
    // truncate the wallet key file into an unreadable state.
    await this.persistence.writeAtomic(this.filePath, markedBuffer)
  }

  /**
   * Read and parse wallet data from disk.
   * Handles three formats:
   *   1. New JSON format (SENC marker + encrypted JSON with type field)
   *   2. Legacy encrypted hex seed (SENC marker + encrypted hex string)
   *   3. Legacy unencrypted raw 32-byte seed
   */
  private async readData(): Promise<StorageData | null> {
    try {
      const buffer = await this.persistence.files.readFile(this.filePath)

      if (buffer.subarray(0, 4).equals(ENCRYPTED_MARKER)) {
        let decrypted: string
        try {
          decrypted = this.storage.decrypt(buffer.subarray(4))
        } catch (err) {
          this.log.error('safeStorage.decryptString failed:', err)
          if (!this.storage.isAvailable()) {
            throw new WalletSystemStorageError(errorMessage(err))
          }
          throw new WalletDecryptionError(errorMessage(err))
        }

        // Try parsing as JSON first (new format)
        if (decrypted.startsWith('{')) {
          try {
            return parseStorageData(JSON.parse(decrypted))
          } catch (error) {
            this.log.error('Invalid wallet key document:', error)
            throw new WalletDecryptionError('Invalid wallet key document')
          }
        }

        // Legacy format: plain hex seed string
        try {
          return parseStorageData({ type: 'seed', seed: decrypted })
        } catch {
          throw new WalletDecryptionError('Invalid legacy wallet secret')
        }
      }

      // Unencrypted fallback (32 raw bytes) — migrate to encrypted format
      if (buffer.length === 32) {
        const seedHex = buffer.toString('hex')
        if (this.storage.isAvailable() && !this.isBasicTextBackend()) {
          await this.migrateRawSeedSafe(seedHex)
          return this.readData()
        }
        return { type: 'seed', seed: seedHex }
      }

      throw new WalletDecryptionError('Unknown wallet file format')
    } catch (error) {
      if (isEnoent(error)) return null
      this.log.error('Failed to read wallet data:', error)
      throw error
    }
  }
}
