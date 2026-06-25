/**
 * Encrypted storage for the Cocoon wallet.
 *
 * Mirrors the SENC-marker + safeStorage pattern used by WalletKeyStorage for
 * the main TON wallet, but kept fully isolated (own file, own class) so the
 * primary wallet is never coupled to Cocoon-specific state.
 *
 * Stores:
 *  - the 24-word mnemonic of the owner wallet (W4R2)
 *  - the 32-byte Ed25519 secret of the node (cocoon_wallet SC) wallet
 *  - cached addresses for fast UI display (re-derivable from secrets)
 */

import { errorMessage } from '../../shared/errors'
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import { SENC_MARKER, writeSencJsonFile } from '../utils/senc'

const log = createLogger('cocoon:wallet-storage')

const FILE_NAME = 'cocoon-wallet.dat'

export interface CocoonWalletData {
  ownerMnemonic: string[]
  nodeSecretBase64: string
  nodePublicKeyHex: string
  ownerAddress: string
  nodeAddress: string
  createdAt: number
  // Set when the user finishes Step 4 (Stake & Start) successfully.
  // null while the wizard is still in progress (fund step or earlier).
  // Optional for backward compatibility with wallets generated before this field
  // was introduced — those are treated as "setup complete" since they pre-date the wizard.
  setupCompletedAt?: number | null
}

export class CocoonWalletDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CocoonWalletDecryptionError'
  }
}

export class CocoonKeyStorage {
  private storage: ISecureStorage
  private filePath: string
  private cached: CocoonWalletData | null = null

  constructor(storage: ISecureStorage = new ElectronSafeStorageAdapter(), basePath?: string) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, FILE_NAME)
  }

  /** True if the user already has a Cocoon wallet on disk. */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Persist a freshly generated wallet to disk (encrypted).
   * Throws if a wallet already exists; the caller must explicitly delete first.
   */
  async save(data: CocoonWalletData): Promise<void> {
    if (await this.exists()) {
      throw new Error('Cocoon wallet already exists; delete it before saving a new one')
    }
    this.ensureEncryptionAvailable()
    await this.write(data)
    this.cached = data
    log.info(`Cocoon wallet saved: owner=${data.ownerAddress.slice(0, 8)}…`)
  }

  /**
   * Overwrite the existing wallet with updated data (encrypted).
   * Used to update non-secret state like `setupCompletedAt`.
   * Throws if no wallet exists; callers should ensure load() succeeded first.
   */
  async update(data: CocoonWalletData): Promise<void> {
    if (!(await this.exists())) {
      throw new Error('Cocoon wallet does not exist; cannot update')
    }
    this.ensureEncryptionAvailable()
    await this.write(data)
    this.cached = data
  }

  /** Read the wallet from disk (or return cached value). */
  async load(): Promise<CocoonWalletData | null> {
    if (this.cached) return this.cached
    try {
      const buf = await fs.readFile(this.filePath)
      if (!buf.subarray(0, 4).equals(SENC_MARKER)) {
        log.error(`Unexpected file format at ${this.filePath} (no SENC marker)`)
        return null
      }
      let json: string
      try {
        json = this.storage.decrypt(buf.subarray(4))
      } catch (err) {
        log.error('safeStorage.decrypt failed:', err)
        throw new CocoonWalletDecryptionError(errorMessage(err))
      }
      const parsed = JSON.parse(json) as CocoonWalletData
      this.cached = parsed
      return parsed
    } catch (err) {
      if (isEnoent(err)) return null
      throw err
    }
  }

  /** Wipe cached data from memory (does not delete the file). */
  lock(): void {
    this.cached = null
  }

  /** Delete the wallet file from disk. Caller is responsible for warning the user. */
  async deleteFile(): Promise<void> {
    this.cached = null
    try {
      await fs.unlink(this.filePath)
    } catch (err) {
      if (!isEnoent(err)) throw err
    }
  }

  /** Test-only / debug: returns the file path. */
  getFilePath(): string {
    return this.filePath
  }

  private ensureEncryptionAvailable(): void {
    if (!this.storage.isAvailable()) {
      throw new Error('Secure storage is not available. Install a keyring (gnome-keyring, kwallet) to use Cocoon AI.')
    }
  }

  private async write(data: CocoonWalletData): Promise<void> {
    await writeSencJsonFile(this.filePath, this.storage, data)
  }
}
