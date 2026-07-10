/**
 * Encrypted archive of consumed Cocoon wallets.
 *
 * Cocoon enforces "1 cocoon_node = 1 stake cycle": once unstaked, the proxy
 * worker's sticky cache marks the node identity as consumed, so the user must
 * rotate to a fresh wallet to re-stake. We archive the old mnemonic + node
 * secret here in case the upstream worker is ever restarted and the stake
 * becomes recoverable. Kept separate from wallet-storage so the live wallet
 * is never coupled to historical entries.
 */

import { join } from 'path'
import { app } from 'electron'
import { z } from 'zod'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { VersionedEncryptedJsonRepository } from '../persistence/versioned-encrypted-json-repository'

const log = createLogger('cocoon:archive')
const FILE_NAME = 'cocoon-archive.dat'

export interface ArchivedCocoon {
  archivedAt: number
  ownerAddress: string
  nodeAddress: string
  ownerMnemonic: string[]
  nodeSecretBase64: string
  nodePublicKeyHex: string
  /** Last known client SC address before archival, if we had one cached. Used for recovery attempts. */
  lastClientSCAddress: string | null
}

interface ArchiveFile {
  entries: ArchivedCocoon[]
}

const ArchivedCocoonSchema = z.object({
  archivedAt: z.number().finite(),
  ownerAddress: z.string(),
  nodeAddress: z.string(),
  ownerMnemonic: z.array(z.string()),
  nodeSecretBase64: z.string(),
  nodePublicKeyHex: z.string(),
  lastClientSCAddress: z.string().nullable(),
})
const ArchiveFileSchema = z.object({ entries: z.array(ArchivedCocoonSchema) })

export class ConsumedArchive {
  private storage: ISecureStorage
  private filePath: string
  private repository: VersionedEncryptedJsonRepository<ArchiveFile>
  private mutationChain: Promise<void> = Promise.resolve()

  constructor(basePath?: string, storage: ISecureStorage = new ElectronSafeStorageAdapter()) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, FILE_NAME)
    this.repository = new VersionedEncryptedJsonRepository({
      filePath: this.filePath,
      version: 1,
      schema: ArchiveFileSchema,
      storage,
      migrate: (raw) => raw,
    })
  }

  async archive(entry: ArchivedCocoon): Promise<void> {
    this.ensureEncryptionAvailable()
    await this.enqueueMutation(async () => {
      const current = await this.readFile()
      const entries = current ? [...current.entries, entry] : [entry]
      await this.writeFile({ entries })
    })
    log.info(
      `Archived consumed cocoon: owner=${entry.ownerAddress.slice(0, 8)}… node=${entry.nodeAddress.slice(0, 8)}…`
    )
  }

  async list(): Promise<ArchivedCocoon[]> {
    await this.mutationChain.catch(() => undefined)
    const data = await this.readFile()
    if (!data) return []
    return [...data.entries].sort((a, b) => a.archivedAt - b.archivedAt)
  }

  async getByArchivedAt(archivedAt: number): Promise<ArchivedCocoon | null> {
    await this.mutationChain.catch(() => undefined)
    const data = await this.readFile()
    if (!data) return null
    return data.entries.find((e) => e.archivedAt === archivedAt) ?? null
  }

  /** Test-only: returns the file path. */
  getFilePath(): string {
    return this.filePath
  }

  private ensureEncryptionAvailable(): void {
    if (!this.storage.isAvailable()) {
      throw new Error('Secure storage is not available. Install a keyring (gnome-keyring, kwallet) to use Cocoon AI.')
    }
  }

  private async readFile(): Promise<ArchiveFile | null> {
    return this.repository.loadOptional()
  }

  private async writeFile(data: ArchiveFile): Promise<void> {
    await this.repository.save(data)
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationChain.catch(() => undefined).then(operation)
    this.mutationChain = result
    return result
  }
}
