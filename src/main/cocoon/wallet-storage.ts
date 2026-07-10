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
import { join } from 'path'
import { app } from 'electron'
import { z } from 'zod'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import {
  EncryptedDocumentError,
  VersionedEncryptedJsonRepository,
} from '../persistence/versioned-encrypted-json-repository'

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

const CocoonWalletDataSchema = z.object({
  ownerMnemonic: z.array(z.string()),
  nodeSecretBase64: z.string(),
  nodePublicKeyHex: z.string(),
  ownerAddress: z.string(),
  nodeAddress: z.string(),
  createdAt: z.number().finite(),
  setupCompletedAt: z.number().finite().nullable().optional(),
})

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
  private repository: VersionedEncryptedJsonRepository<CocoonWalletData>

  constructor(storage: ISecureStorage = new ElectronSafeStorageAdapter(), basePath?: string) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, FILE_NAME)
    this.repository = new VersionedEncryptedJsonRepository({
      filePath: this.filePath,
      version: 1,
      schema: CocoonWalletDataSchema,
      storage,
      migrate: (raw) => raw,
    })
  }

  /** True if the user already has a Cocoon wallet on disk. */
  async exists(): Promise<boolean> {
    return this.repository.exists()
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
      const parsed = await this.repository.loadOptional()
      this.cached = parsed
      return parsed
    } catch (error) {
      if (error instanceof EncryptedDocumentError && error.stage === 'format') {
        log.error(error.message)
        return null
      }
      if (error instanceof EncryptedDocumentError && error.stage === 'decrypt') {
        log.error('safeStorage.decrypt failed:', error.cause)
        throw new CocoonWalletDecryptionError(errorMessage(error.cause ?? error))
      }
      throw error
    }
  }

  /** Wipe cached data from memory (does not delete the file). */
  lock(): void {
    this.cached = null
  }

  /** Delete the wallet file from disk. Caller is responsible for warning the user. */
  async deleteFile(): Promise<void> {
    this.cached = null
    await this.repository.remove()
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
    await this.repository.save(data)
  }
}
