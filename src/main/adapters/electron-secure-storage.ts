import { safeStorage } from 'electron'
import type { ISecureStorage } from '../ports/secure-storage'

export class ElectronSafeStorageAdapter implements ISecureStorage {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext)
  }

  decrypt(encrypted: Buffer): string {
    return safeStorage.decryptString(encrypted)
  }

  getBackendName(): string {
    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return 'unknown'
    }
  }
}
