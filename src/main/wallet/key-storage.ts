import { errorMessage } from '../../shared/errors'
import { promises as fs, constants as fsConstants } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { keyPairFromSeed, mnemonicNew } from '@ton/crypto'
import { WALLET_FILE_NAME, AUTO_LOCK_DEFAULT_MS } from './constants'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import { writeSecureFileAtomic } from '../utils/secure-fs'
import { z } from 'zod'
import { generateMnemonic } from 'bip39'
import {
  PasswordEnvelopeSchema,
  decryptWalletSecret,
  encryptWalletSecret,
  type PasswordEnvelope,
  type WalletSecret,
} from './password-vault'
import { deriveWalletKeyPair, detectMnemonicSchemes, type MnemonicScheme, type WalletVersion } from './wallet-versions'
const log = createLogger('wallet:keys')

const ENCRYPTED_MARKER = Buffer.from('SENC')
const WALLET_KEY_SCHEMA_VERSION = 1

export class WalletDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletDecryptionError'
  }
}

interface MnemonicStorageData {
  type: 'mnemonic'
  mnemonic: string[]
}

interface SeedStorageData {
  type: 'seed'
  seed: string
}

type StorageData = MnemonicStorageData | SeedStorageData | PasswordEnvelope

const LegacyStorageDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mnemonic'), mnemonic: z.array(z.string().min(1)).length(24) }),
  z.object({ type: z.literal('seed'), seed: z.string().regex(/^[a-fA-F0-9]{64}$/) }),
])
const StorageDataSchema = z.union([LegacyStorageDataSchema, PasswordEnvelopeSchema])

const StorageDocumentSchema = z.object({
  schemaVersion: z.union([z.literal(WALLET_KEY_SCHEMA_VERSION), z.literal(2)]),
  data: StorageDataSchema,
})

function parseStorageData(raw: unknown): StorageData {
  const current = StorageDocumentSchema.safeParse(raw)
  if (current.success) return current.data.data
  return StorageDataSchema.parse(raw)
}

function encodeStorageData(data: StorageData): string {
  const validated = StorageDataSchema.parse(data)
  return JSON.stringify({
    schemaVersion: validated.type === 'password' ? 2 : WALLET_KEY_SCHEMA_VERSION,
    data: validated,
  })
}

export class WalletKeyStorage {
  private storage: ISecureStorage
  private filePath: string
  private cachedPublicKey: Buffer | null = null
  private cachedSecretKey: Buffer | null = null
  private lockTimer: ReturnType<typeof setTimeout> | null = null
  private autoLockMs: number = AUTO_LOCK_DEFAULT_MS
  private onLock: (() => void) | null = null

  constructor(storage: ISecureStorage = new ElectronSafeStorageAdapter(), basePath?: string) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, `${WALLET_FILE_NAME}.dat`)
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

  async generateFromMnemonic(
    password?: string,
    mnemonicScheme: MnemonicScheme = 'bip39'
  ): Promise<{
    keypair: { publicKey: Buffer; secretKey: Buffer }
    mnemonic: string[]
    mnemonicScheme: MnemonicScheme
  }> {
    if (await this.exists()) {
      throw new Error('Wallet already exists')
    }

    this.ensureEncryptionAvailable()

    if (this.isBasicTextBackend() && !password) {
      log.warn('Linux basic_text backend detected: mnemonic stored with weak encryption')
    }

    const mnemonic = mnemonicScheme === 'ton' ? await mnemonicNew(24) : generateMnemonic(128).split(' ')
    const keypair = await deriveWalletKeyPair(mnemonic, mnemonicScheme)

    const secret: MnemonicStorageData = { type: 'mnemonic', mnemonic }
    const data = password
      ? await encryptWalletSecret(secret, password, keypair.publicKey, false, 'v5R1', mnemonicScheme)
      : secret
    await this.storeData(data)

    this.cachedPublicKey = keypair.publicKey
    this.cachedSecretKey = keypair.secretKey
    this.resetLockTimer()
    log.info('Generated new mnemonic-based wallet keypair')
    return { keypair, mnemonic, mnemonicScheme }
  }

  async importFromMnemonic(
    words: string[],
    password?: string,
    walletVersion: WalletVersion = 'v5R1',
    mnemonicScheme: MnemonicScheme = 'ton'
  ): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    this.ensureEncryptionAvailable()

    if (!(await detectMnemonicSchemes(words)).includes(mnemonicScheme)) {
      throw new Error('Invalid mnemonic phrase')
    }

    if (this.isBasicTextBackend() && !password) {
      log.warn('Linux basic_text backend detected: mnemonic stored with weak encryption')
    }

    const keypair = await deriveWalletKeyPair(words, mnemonicScheme)
    const secret: MnemonicStorageData = { type: 'mnemonic', mnemonic: words }
    const data = password
      ? await encryptWalletSecret(secret, password, keypair.publicKey, true, walletVersion, mnemonicScheme)
      : secret
    const replacing = await this.exists()
    if (replacing) {
      await fs.copyFile(this.filePath, this.importBakPath)
      if (process.platform !== 'win32') await fs.chmod(this.importBakPath, 0o600)
    }
    try {
      await this.storeData(data)
    } catch (error) {
      keypair.secretKey.fill(0)
      keypair.publicKey.fill(0)
      throw error
    }

    this.cachedPublicKey = keypair.publicKey
    this.cachedSecretKey = keypair.secretKey
    this.resetLockTimer()
    log.info('Imported wallet from mnemonic')
    return keypair
  }

  async getMnemonic(password?: string): Promise<{ mnemonic: string[] } | null> {
    const stored = await this.readData()
    const data = stored?.type === 'password' ? await this.decryptEnvelope(stored, password) : stored
    if (!data) {
      throw new Error('No wallet data found')
    }
    if (data.type === 'mnemonic') {
      return { mnemonic: data.mnemonic }
    }
    return null
  }

  async load(password?: string): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    if (this.cachedPublicKey && this.cachedSecretKey) {
      return { publicKey: this.cachedPublicKey, secretKey: this.cachedSecretKey }
    }

    const stored = await this.readData()
    if (!stored) {
      throw new Error('No wallet data found')
    }
    const data = stored.type === 'password' ? await this.decryptEnvelope(stored, password) : stored
    if (stored.type === 'password') await fs.unlink(this.passwordBakPath).catch(() => undefined)

    let keypair: { publicKey: Buffer; secretKey: Buffer }
    if (data.type === 'mnemonic') {
      keypair = await deriveWalletKeyPair(data.mnemonic, stored.type === 'password' ? stored.mnemonicScheme : 'ton')
    } else {
      const seed = Buffer.from(data.seed, 'hex')
      keypair = keyPairFromSeed(seed)
      seed.fill(0)
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
    return {
      publicKey: null,
      passwordProtected: false,
      backupVerified: false,
      walletVersion: 'v5R1',
      mnemonicScheme: 'ton',
    }
  }

  async protectWithPassword(password: string): Promise<void> {
    const stored = await this.readData()
    if (!stored) throw new Error('No wallet data found')
    if (stored.type === 'password') throw new Error('Wallet is already password protected')
    const keypair = await this.load()
    const envelope = await encryptWalletSecret(stored, password, keypair.publicKey, stored.type === 'seed')
    await fs.copyFile(this.filePath, this.passwordBakPath)
    if (process.platform !== 'win32') await fs.chmod(this.passwordBakPath, 0o600)
    try {
      await this.storeData(envelope)
      const verified = await this.readData()
      if (!verified || verified.type !== 'password') throw new Error('Password vault verification failed')
      await this.decryptEnvelope(verified, password)
      await fs.unlink(this.passwordBakPath)
    } catch (error) {
      await fs.copyFile(this.passwordBakPath, this.filePath).catch(() => undefined)
      throw error
    }
  }

  async markBackupVerified(password: string): Promise<void> {
    const stored = await this.readData()
    if (!stored || stored.type !== 'password') throw new Error('Password-protected wallet required')
    const secret = await decryptWalletSecret(stored, password)
    const envelope = await encryptWalletSecret(
      secret,
      password,
      Buffer.from(stored.publicKey, 'hex'),
      true,
      stored.walletVersion,
      stored.mnemonicScheme
    )
    await this.storeData(envelope)
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
    await fs.copyFile(this.filePath, this.passwordBakPath)
    if (process.platform !== 'win32') await fs.chmod(this.passwordBakPath, 0o600)
    try {
      await this.storeData(envelope)
      await decryptWalletSecret(envelope, nextPassword)
      await fs.unlink(this.passwordBakPath)
    } catch (error) {
      await fs.copyFile(this.passwordBakPath, this.filePath).catch(() => undefined)
      throw error
    }
  }

  private async decryptEnvelope(envelope: PasswordEnvelope, password?: string): Promise<WalletSecret> {
    if (!password) throw new WalletDecryptionError('Wallet is locked')
    try {
      const secret = await decryptWalletSecret(envelope, password)
      const keypair =
        secret.type === 'mnemonic'
          ? await deriveWalletKeyPair(secret.mnemonic, envelope.mnemonicScheme)
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
      await fs.access(this.filePath)
      return true
    } catch {
      return false
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

  setOnLock(listener: (() => void) | null): void {
    this.onLock = listener
  }

  lock(): void {
    const wasUnlocked = this.cachedSecretKey !== null
    if (this.cachedSecretKey) {
      this.cachedSecretKey.fill(0)
      this.cachedSecretKey = null
      log.info('Wallet locked: secret key cleared from memory')
    }
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
    if (wasUnlocked) this.onLock?.()
  }

  isLocked(): boolean {
    return this.cachedPublicKey !== null && this.cachedSecretKey === null
  }

  getPublicKey(): Buffer | null {
    return this.cachedPublicKey
  }

  destroy(): void {
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
    for (const path of [
      this.filePath,
      this.bakPath,
      this.passwordBakPath,
      this.importBakPath,
      `${this.filePath}.tmp`,
    ]) {
      try {
        await fs.unlink(path)
      } catch (error) {
        if (!isEnoent(error)) throw error
      }
    }
  }

  private resetLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
    }
    if (this.autoLockMs > 0) {
      this.lockTimer = setTimeout(() => this.lock(), this.autoLockMs)
    }
  }

  /**
   * Atomically migrate a legacy 32-byte raw seed to the encrypted format.
   *
   * Steps:
   *   1. Copy the original file to <filePath>.pre-migration.bak (chmod 0o600, overwrite-safe).
   *   2. Write the new encrypted file via tmp+rename (atomic).
   *   3. Decrypt the new file and verify the seed round-trips correctly.
   *   4. Delete the backup only after verification succeeds.
   *
   * On any failure the backup is left on disk.  The next call to readData()
   * will detect the bak file and attempt recovery before re-running migration.
   */
  private async migrateRawSeedSafe(seedHex: string): Promise<void> {
    const bak = this.bakPath
    const tmp = `${this.filePath}.tmp`

    // --- 0. Handle stale backup from a previously interrupted migration ---
    let bakExists = false
    try {
      await fs.access(bak, fsConstants.F_OK)
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
          await fs.unlink(bak)
          log.info('Removed stale migration backup after verifying main file is valid')
        } catch (err) {
          log.warn('Could not remove stale migration backup:', err)
        }
        return
      }
      // Main file is not valid — previous migration failed mid-write.
      // Restore from backup so the user's seed is intact, then retry.
      log.warn('Detected interrupted migration; restoring from backup and retrying')
      try {
        await fs.copyFile(bak, this.filePath)
        if (process.platform !== 'win32') await fs.chmod(this.filePath, 0o600)
      } catch (restoreErr) {
        log.error('Failed to restore from backup; leaving backup in place:', restoreErr)
        return
      }
    }

    try {
      // --- 1. Create backup of the original raw-seed file ---
      await fs.copyFile(this.filePath, bak)
      if (process.platform !== 'win32') await fs.chmod(bak, 0o600)

      // --- 2. Write new encrypted file atomically (tmp → rename) ---
      const data: SeedStorageData = { type: 'seed', seed: seedHex }
      const json = encodeStorageData(data)
      const encrypted = this.storage.encrypt(json)
      const markedBuffer = Buffer.concat([ENCRYPTED_MARKER, encrypted])
      await fs.writeFile(tmp, markedBuffer, { mode: 0o600 })
      await fs.rename(tmp, this.filePath)

      // --- 3. Verify the new file is readable and decrypts correctly ---
      const verified = await this.verifySeedFile(seedHex)
      if (!verified) {
        throw new Error('Post-migration verification failed: decrypted seed does not match original')
      }

      // --- 4. Remove backup only after successful verification ---
      await fs.unlink(bak)
      log.info('Migrated legacy unencrypted seed to encrypted format')
    } catch (err) {
      log.error('Failed to migrate legacy seed (backup preserved at', bak, '):', err)
      // Clean up any partial tmp file
      try {
        await fs.unlink(tmp)
      } catch {
        /* tmp may not exist */
      }
    }
  }

  /**
   * Read the wallet file and verify that it decrypts to the expected seedHex.
   * Returns true if the file is valid and the seed matches.
   */
  private async verifySeedFile(expectedSeedHex: string): Promise<boolean> {
    try {
      const buf = await fs.readFile(this.filePath)
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
    await writeSecureFileAtomic(this.filePath, markedBuffer)
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
      const buffer = await fs.readFile(this.filePath)

      if (buffer.subarray(0, 4).equals(ENCRYPTED_MARKER)) {
        let decrypted: string
        try {
          decrypted = this.storage.decrypt(buffer.subarray(4))
        } catch (err) {
          log.error('safeStorage.decryptString failed:', err)
          throw new WalletDecryptionError(errorMessage(err))
        }

        // Try parsing as JSON first (new format)
        if (decrypted.startsWith('{')) {
          try {
            return parseStorageData(JSON.parse(decrypted))
          } catch (error) {
            log.error('Invalid wallet key document:', error)
            return null
          }
        }

        // Legacy format: plain hex seed string
        const legacy = StorageDataSchema.safeParse({ type: 'seed', seed: decrypted })
        return legacy.success ? legacy.data : null
      }

      // Unencrypted fallback (32 raw bytes) — migrate to encrypted format
      if (buffer.length === 32) {
        const seedHex = buffer.toString('hex')
        if (this.storage.isAvailable() && !this.isBasicTextBackend()) {
          await this.migrateRawSeedSafe(seedHex)
        }
        return { type: 'seed', seed: seedHex }
      }

      log.error('Unknown wallet file format')
      return null
    } catch (error) {
      if (isEnoent(error)) return null
      log.error('Failed to read wallet data:', error)
      throw error
    }
  }
}
