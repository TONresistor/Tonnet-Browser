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
  private cachedKeypair: { publicKey: Buffer; secretKey: Buffer } | null = null

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

    this.cachedKeypair = keypair
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

    this.cachedKeypair = keypair
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
    if (this.cachedKeypair) {
      return this.cachedKeypair
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

    this.cachedKeypair = keypair
    return keypair
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
   * Wipe cached keys from memory.
   */
  destroy(): void {
    if (this.cachedKeypair) {
      this.cachedKeypair.secretKey.fill(0)
      this.cachedKeypair.publicKey.fill(0)
      this.cachedKeypair = null
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
        const decrypted = safeStorage.decryptString(buffer.subarray(4))

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

      // Unencrypted fallback (32 raw bytes)
      if (buffer.length === 32) {
        return { type: 'seed', seed: buffer.toString('hex') }
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
