/**
 * Wallet key storage.
 * Generates and stores Ed25519 keypairs using Electron's safeStorage API.
 * Supports both legacy raw-seed wallets and mnemonic-based wallets.
 */

import { safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { keyPairFromSeed, mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { WALLET_FILE_NAME } from '../../shared/constants'
import { createLogger } from '../../shared/logger'
const log = createLogger('wallet:keys')

const ENCRYPTED_MARKER = Buffer.from('SENC')

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

type StorageData = MnemonicStorageData | SeedStorageData

export class WalletKeyStorage {
  private filePath: string
  private cachedPublicKey: Buffer | null = null
  private cachedSecretKey: Buffer | null = null
  private lockTimer: ReturnType<typeof setTimeout> | null = null
  private autoLockMs: number = 5 * 60 * 1000 // default 5 minutes

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = join(userDataPath, `${WALLET_FILE_NAME}.dat`)
  }

  /**
   * Check if the Linux basic_text backend is in use (no real encryption).
   */
  isBasicTextBackend(): boolean {
    try {
      const backend = safeStorage.getSelectedStorageBackend()
      return backend === 'basic_text'
    } catch {
      return false
    }
  }

  private ensureEncryptionAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available. Install a keyring (gnome-keyring, kwallet) to use the wallet.')
    }
  }

  /**
   * Generate a new wallet from a 24-word mnemonic.
   * All new wallets use mnemonic for compatibility with Tonkeeper/MyTonWallet.
   */
  async generate(): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    const { keypair } = await this.generateFromMnemonic()
    return keypair
  }

  /**
   * Generate a 24-word mnemonic, derive keypair, store both encrypted.
   */
  async generateFromMnemonic(): Promise<{ keypair: { publicKey: Buffer; secretKey: Buffer }; mnemonic: string[] }> {
    if (await this.exists()) {
      throw new Error('Wallet already exists')
    }

    this.ensureEncryptionAvailable()

    if (this.isBasicTextBackend()) {
      log.warn('Linux basic_text backend detected: mnemonic stored with weak encryption')
    }

    const mnemonic = await mnemonicNew(24)
    const keypair = await mnemonicToPrivateKey(mnemonic)

    const data: MnemonicStorageData = { type: 'mnemonic', mnemonic }
    await this.storeData(data)

    this.cachedPublicKey = keypair.publicKey
    this.cachedSecretKey = keypair.secretKey
    this.resetLockTimer()
    log.info('Generated new mnemonic-based wallet keypair')
    return { keypair, mnemonic }
  }

  /**
   * Import a wallet from an existing 24-word mnemonic.
   */
  async importFromMnemonic(words: string[]): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    this.ensureEncryptionAvailable()

    const valid = await mnemonicValidate(words)
    if (!valid) {
      throw new Error('Invalid mnemonic phrase')
    }

    if (this.isBasicTextBackend()) {
      log.warn('Linux basic_text backend detected: mnemonic stored with weak encryption')
    }

    const keypair = await mnemonicToPrivateKey(words)
    const data: MnemonicStorageData = { type: 'mnemonic', mnemonic: words }
    await this.storeData(data)

    this.cachedPublicKey = keypair.publicKey
    this.cachedSecretKey = keypair.secretKey
    this.resetLockTimer()
    log.info('Imported wallet from mnemonic')
    return keypair
  }

  /**
   * Retrieve the stored mnemonic words (for export/backup).
   * Returns null for legacy seed-based wallets.
   */
  async getMnemonic(): Promise<{ mnemonic: string[] } | null> {
    const data = await this.readData()
    if (!data) {
      throw new Error('No wallet data found')
    }
    if (data.type === 'mnemonic') {
      return { mnemonic: data.mnemonic }
    }
    return null
  }

  /**
   * Load the keypair from encrypted storage.
   * Handles both legacy hex-seed format and new JSON mnemonic format.
   */
  async load(): Promise<{ publicKey: Buffer; secretKey: Buffer }> {
    if (this.cachedPublicKey && this.cachedSecretKey) {
      return { publicKey: this.cachedPublicKey, secretKey: this.cachedSecretKey }
    }

    const data = await this.readData()
    if (!data) {
      throw new Error('No wallet data found')
    }

    let keypair: { publicKey: Buffer; secretKey: Buffer }
    if (data.type === 'mnemonic') {
      keypair = await mnemonicToPrivateKey(data.mnemonic)
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

  /**
   * Check if a wallet key file exists on disk.
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Derive the W5 v5r1 wallet address from the stored keypair.
   */
  async getAddress(): Promise<{ address: string; addressRaw: string }> {
    const keypair = await this.load()
    const wallet = WalletContractV5R1.create({ publicKey: keypair.publicKey, workchain: 0 })
    return {
      address: wallet.address.toString({ bounceable: false }),
      addressRaw: wallet.address.toRawString(),
    }
  }

  /**
   * Configure auto-lock timer duration. 0 = disabled.
   */
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

  /**
   * Clear secret key from memory. Public key remains for read operations.
   */
  lock(): void {
    if (this.cachedSecretKey) {
      this.cachedSecretKey.fill(0)
      this.cachedSecretKey = null
      log.info('Wallet locked: secret key cleared from memory')
    }
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
  }

  /**
   * Check if wallet exists but secret key is not in memory.
   */
  isLocked(): boolean {
    return this.cachedPublicKey !== null && this.cachedSecretKey === null
  }

  /**
   * Get cached public key without decryption.
   */
  getPublicKey(): Buffer | null {
    return this.cachedPublicKey
  }

  /**
   * Wipe cached keys from memory.
   */
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

  /**
   * Delete the wallet file from disk so a new one can be created or imported.
   */
  async deleteFile(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error
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

  private async storeData(data: StorageData): Promise<void> {
    this.ensureEncryptionAvailable()
    const json = JSON.stringify(data)
    const encrypted = safeStorage.encryptString(json)
    const markedBuffer = Buffer.concat([ENCRYPTED_MARKER, encrypted])
    await fs.writeFile(this.filePath, markedBuffer)
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
          decrypted = safeStorage.decryptString(buffer.subarray(4))
        } catch (err) {
          log.error('safeStorage.decryptString failed:', err)
          throw new WalletDecryptionError((err as Error).message)
        }

        // Try parsing as JSON first (new format)
        if (decrypted.startsWith('{')) {
          try {
            const parsed = JSON.parse(decrypted) as StorageData
            return parsed
          } catch {
            // Not valid JSON, fall through to legacy hex
          }
        }

        // Legacy format: plain hex seed string
        return { type: 'seed', seed: decrypted }
      }

      // Unencrypted fallback (32 raw bytes) — migrate to encrypted format
      if (buffer.length === 32) {
        const seedHex = buffer.toString('hex')
        if (safeStorage.isEncryptionAvailable() && !this.isBasicTextBackend()) {
          try {
            const data: SeedStorageData = { type: 'seed', seed: seedHex }
            await this.storeData(data)
            log.info('Migrated legacy unencrypted seed to encrypted format')
          } catch (err) {
            log.error('Failed to migrate legacy seed:', err)
          }
        }
        return { type: 'seed', seed: seedHex }
      }

      log.error('Unknown wallet file format')
      return null
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return null
      }
      log.error('Failed to read wallet data:', error)
      throw error
    }
  }
}
