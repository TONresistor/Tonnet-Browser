import type { ISecureStorage } from '../ports/secure-storage'
import { ElectronSafeStorageAdapter } from './electron-secure-storage'
import { FallbackSecureStorage } from './fallback-secure-storage'

/** Prefer OS-backed safeStorage; fall back to local persistence when unavailable. */
export function createSecureStorage(): ISecureStorage {
  const electron = new ElectronSafeStorageAdapter()
  if (electron.isAvailable()) return electron
  return new FallbackSecureStorage()
}
