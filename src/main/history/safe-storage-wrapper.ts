/**
 * Safe Storage Wrapper for transparent encryption/decryption
 * Uses Electron's safeStorage API (OS keychain: Keychain on macOS, DPAPI on Windows, libsecret on Linux)
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from '../adapters/electron-secure-storage'
import { createLogger } from '../../shared/logger'
import { isEnoent } from '../utils/errors'
import { writeFileAtomic, writeSecureFileAtomic } from '../utils/secure-fs'
import { SENC_MARKER, encodeSenc } from '../utils/senc'
const log = createLogger('history')

export interface VersionedSafeStorageOptions<T> {
  version: number
  migrate(raw: unknown, storedVersion: number): unknown
  parse(raw: unknown): T
}

interface StoredEnvelope {
  schemaVersion: number
  payload: unknown
}

export class SafeStorageWrapper<T> {
  private storage: ISecureStorage
  private filePath: string
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    name: string,
    private readonly options: VersionedSafeStorageOptions<T>,
    storage: ISecureStorage = new ElectronSafeStorageAdapter(),
    basePath?: string
  ) {
    this.storage = storage
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, `${name}.dat`)
    log.debug(`Storage path: ${this.filePath}`)
  }

  /**
   * Check if encryption is available on this platform
   */
  isAvailable(): boolean {
    return this.storage.isAvailable()
  }

  /**
   * Write data with automatic encryption.
   * Encrypted files are prefixed with the SENC marker.
   * Plaintext files are written as UTF-8 JSON with no marker.
   */
  async write(data: T): Promise<void> {
    const value = this.options.parse(data)
    const write = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          const json = JSON.stringify({ schemaVersion: this.options.version, payload: value })
          if (!this.isAvailable()) {
            log.warn('Encryption not available, storing unencrypted')
            await writeSecureFileAtomic(this.filePath, json, 'utf-8')
            return
          }
          const markedBuffer = encodeSenc(this.storage, json)
          await writeFileAtomic(this.filePath, markedBuffer)
          log.debug(`Wrote ${markedBuffer.length} encrypted bytes (with SENC marker)`)
        } catch (error) {
          log.error('Failed to write:', error)
          throw error
        }
      })
    this.writeChain = write
    await write
  }

  /**
   * Read data with automatic decryption.
   * Format is detected from the file contents — not from current encryption availability:
   *   - Starts with 'SENC' → new encrypted format (decrypt bytes after the marker)
   *   - Starts with '{' or '[' → plaintext JSON
   *   - Otherwise → legacy encrypted format (no marker); try to decrypt, fall back to empty array
   */
  async read(): Promise<T | null> {
    try {
      const buffer = await fs.readFile(this.filePath)

      // New encrypted format: SENC marker prefix
      if (buffer.subarray(0, 4).equals(SENC_MARKER)) {
        try {
          const decrypted = this.storage.decrypt(buffer.subarray(4))
          return this.decode(JSON.parse(decrypted))
        } catch (decryptError) {
          log.error('SENC-marked file failed to decrypt, treating as corrupt:', decryptError)
          return null
        }
      }

      // Plaintext JSON (written when encryption was unavailable)
      const firstByte = buffer[0]
      if (firstByte === 0x7b /* '{' */ || firstByte === 0x5b /* '[' */) {
        const json = buffer.toString('utf-8')
        return this.decode(JSON.parse(json))
      }

      // Legacy encrypted format (written before SENC marker was introduced)
      log.info('Detected legacy encrypted file (no SENC marker), attempting decrypt')
      try {
        const decrypted = this.storage.decrypt(buffer)
        return this.decode(JSON.parse(decrypted))
      } catch (legacyError) {
        log.error('Legacy encrypted file could not be decrypted:', legacyError)
        return null
      }
    } catch (error) {
      if (isEnoent(error)) return null
      log.error('Failed to read:', error)
      throw error
    }
  }

  private decode(raw: unknown): T {
    const envelope = asEnvelope(raw)
    if (envelope && envelope.schemaVersion > this.options.version) {
      throw new Error(`Unsupported schema version ${envelope.schemaVersion} for ${this.filePath}`)
    }
    const migrated = this.options.migrate(envelope?.payload ?? raw, envelope?.schemaVersion ?? 0)
    return this.options.parse(migrated)
  }

  /**
   * Delete the encrypted file
   */
  async delete(): Promise<void> {
    try {
      await this.writeChain.catch(() => undefined)
      await fs.unlink(this.filePath)
      log.info('Deleted storage file')
    } catch (error) {
      if (!isEnoent(error)) {
        log.error('Failed to delete:', error)
        throw error
      }
    }
  }

  /**
   * Check if file exists (async)
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath)
      return true
    } catch {
      return false
    }
  }
}

function asEnvelope(raw: unknown): StoredEnvelope | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Partial<StoredEnvelope>
  if (!Number.isInteger(candidate.schemaVersion) || (candidate.schemaVersion ?? -1) < 0 || !('payload' in candidate)) {
    return null
  }
  return { schemaVersion: candidate.schemaVersion as number, payload: candidate.payload }
}
