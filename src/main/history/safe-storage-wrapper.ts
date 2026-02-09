/**
 * Safe Storage Wrapper for transparent encryption/decryption
 * Uses Electron's safeStorage API (OS keychain: Keychain on macOS, DPAPI on Windows, libsecret on Linux)
 */

import { safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { logger } from '../../shared/logger'

export class SafeStorageWrapper {
  private filePath: string

  constructor(name: string) {
    const userDataPath = app.getPath('userData')
    this.filePath = join(userDataPath, `${name}.dat`)
    logger.info('SafeStorage', `Storage path: ${this.filePath}`)
  }

  /**
   * Check if encryption is available on this platform
   */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * Write data with automatic encryption
   */
  async write<T>(data: T): Promise<void> {
    try {
      const json = JSON.stringify(data)

      if (!this.isAvailable()) {
        logger.warn('SafeStorage', 'Encryption not available, storing unencrypted')
        await fs.writeFile(this.filePath, json, 'utf-8')
        return
      }

      const encrypted = safeStorage.encryptString(json)
      await fs.writeFile(this.filePath, encrypted)
      logger.info('SafeStorage', `Wrote ${encrypted.length} encrypted bytes`)
    } catch (error) {
      logger.error('SafeStorage', 'Failed to write:', error)
      throw error
    }
  }

  /**
   * Read data with automatic decryption
   */
  async read<T>(): Promise<T | null> {
    try {
      const buffer = await fs.readFile(this.filePath)

      if (!this.isAvailable()) {
        // File was stored unencrypted
        const json = buffer.toString('utf-8')
        return JSON.parse(json)
      }

      const decrypted = safeStorage.decryptString(buffer)
      return JSON.parse(decrypted)
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist
        return null
      }
      logger.error('SafeStorage', 'Failed to read:', error)
      throw error
    }
  }

  /**
   * Delete the encrypted file
   */
  async delete(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
      logger.info('SafeStorage', 'Deleted storage file')
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error('SafeStorage', 'Failed to delete:', error)
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
