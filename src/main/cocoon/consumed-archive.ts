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

import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'

const log = createLogger('cocoon:archive')

const ENCRYPTED_MARKER = Buffer.from('SENC')
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

export class ConsumedArchive {
  private storage: ISecureStorage
  private filePath: string

  constructor(basePath?: string, storage: ISecureStorage = new ElectronSafeStorageAdapter()) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, FILE_NAME)
  }

  async archive(entry: ArchivedCocoon): Promise<void> {
    this.ensureEncryptionAvailable()
    const current = await this.readFile()
    const entries = current ? [...current.entries, entry] : [entry]
    await this.writeFile({ entries })
    log.info(
      `Archived consumed cocoon: owner=${entry.ownerAddress.slice(0, 8)}… node=${entry.nodeAddress.slice(0, 8)}…`
    )
  }

  async list(): Promise<ArchivedCocoon[]> {
    const data = await this.readFile()
    if (!data) return []
    return [...data.entries].sort((a, b) => a.archivedAt - b.archivedAt)
  }

  async getByArchivedAt(archivedAt: number): Promise<ArchivedCocoon | null> {
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
    let buf: Buffer
    try {
      buf = await fs.readFile(this.filePath)
    } catch (err) {
      if (isEnoent(err)) return null
      throw err
    }
    if (!buf.subarray(0, 4).equals(ENCRYPTED_MARKER)) {
      throw new Error(`Unexpected file format at ${this.filePath} (no SENC marker)`)
    }
    const json = this.storage.decrypt(buf.subarray(4))
    return JSON.parse(json) as ArchiveFile
  }

  private async writeFile(data: ArchiveFile): Promise<void> {
    const json = JSON.stringify(data)
    const encrypted = this.storage.encrypt(json)
    const marked = Buffer.concat([ENCRYPTED_MARKER, encrypted])
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, marked, { mode: 0o600 })
    await fs.rename(tmp, this.filePath)
    if (process.platform !== 'win32') await fs.chmod(this.filePath, 0o600)
  }
}

let singleton: ConsumedArchive | null = null

export function getConsumedArchive(): ConsumedArchive {
  if (!singleton) singleton = new ConsumedArchive()
  return singleton
}

export function _setConsumedArchiveForTesting(s: ConsumedArchive | null): void {
  singleton = s
}
