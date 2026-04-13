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
const log = createLogger('history')

// 4-byte magic prefix that marks an encrypted file written by this wrapper
const ENCRYPTED_MARKER = Buffer.from('SENC')

export class SafeStorageWrapper {
  private storage: ISecureStorage
  private filePath: string

  constructor(name: string, storage: ISecureStorage = new ElectronSafeStorageAdapter(), basePath?: string) {
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
  async write<T>(data: T): Promise<void> {
    try {
      const json = JSON.stringify(data)

      if (!this.isAvailable()) {
        log.warn('Encryption not available, storing unencrypted')
        await fs.writeFile(this.filePath, json, 'utf-8')
        // Restrict file permissions when encryption is unavailable
        if (process.platform !== 'win32') {
          await fs.chmod(this.filePath, 0o600)
        }
        return
      }

      const encrypted = this.storage.encrypt(json)
      // Prepend the SENC marker so the read path can detect the format
      const markedBuffer = Buffer.concat([ENCRYPTED_MARKER, encrypted])
      await fs.writeFile(this.filePath, markedBuffer)
      log.debug(`Wrote ${markedBuffer.length} encrypted bytes (with SENC marker)`)
    } catch (error) {
      log.error('Failed to write:', error)
      throw error
    }
  }

  /**
   * Read data with automatic decryption.
   * Format is detected from the file contents — not from current encryption availability:
   *   - Starts with 'SENC' → new encrypted format (decrypt bytes after the marker)
   *   - Starts with '{' or '[' → plaintext JSON
   *   - Otherwise → legacy encrypted format (no marker); try to decrypt, fall back to empty array
   */
  async read<T>(): Promise<T | null> {
    try {
      const buffer = await fs.readFile(this.filePath)

      // New encrypted format: SENC marker prefix
      if (buffer.subarray(0, 4).equals(ENCRYPTED_MARKER)) {
        try {
          const decrypted = this.storage.decrypt(buffer.subarray(4))
          return JSON.parse(decrypted)
        } catch (decryptError) {
          log.error('SENC-marked file failed to decrypt, treating as corrupt:', decryptError)
          return null
        }
      }

      // Plaintext JSON (written when encryption was unavailable)
      const firstByte = buffer[0]
      if (firstByte === 0x7b /* '{' */ || firstByte === 0x5b /* '[' */) {
        const json = buffer.toString('utf-8')
        return JSON.parse(json)
      }

      // Legacy encrypted format (written before SENC marker was introduced)
      log.info('Detected legacy encrypted file (no SENC marker), attempting decrypt')
      try {
        const decrypted = this.storage.decrypt(buffer)
        return JSON.parse(decrypted)
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

  /**
   * Delete the encrypted file
   */
  async delete(): Promise<void> {
    try {
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
   * Check if file exists (synchronous)
   */
  existsSync(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('fs').accessSync(this.filePath)
      return true
    } catch {
      return false
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
