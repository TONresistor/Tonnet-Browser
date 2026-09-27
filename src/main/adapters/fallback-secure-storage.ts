import type { ISecureStorage } from '../ports/secure-storage'

/** Marks storage adapters that are not backed by the OS keychain. */
export interface FallbackSecureStorageMarker {
  readonly isFallbackStorage: true
}

export function isFallbackSecureStorage(
  storage: ISecureStorage
): storage is ISecureStorage & FallbackSecureStorageMarker {
  return 'isFallbackStorage' in storage && storage.isFallbackStorage === true
}

/**
 * Last-resort wallet storage when Electron safeStorage is unavailable.
 * Password-protected wallets still rely on the app password vault; this layer
 * only persists the already-encrypted envelope on disk with 0o600 permissions.
 */
export class FallbackSecureStorage implements ISecureStorage, FallbackSecureStorageMarker {
  readonly isFallbackStorage = true as const

  isAvailable(): boolean {
    return true
  }

  encrypt(plaintext: string): Buffer {
    return Buffer.from(plaintext, 'utf-8')
  }

  decrypt(encrypted: Buffer): string {
    return encrypted.toString('utf-8')
  }

  getBackendName(): string {
    return 'basic_text'
  }
}
