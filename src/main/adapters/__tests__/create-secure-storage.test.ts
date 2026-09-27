import { describe, expect, it, vi } from 'vitest'
import { createSecureStorage } from '../create-secure-storage'
import { FallbackSecureStorage, isFallbackSecureStorage } from '../fallback-secure-storage'

vi.mock('../electron-secure-storage', () => ({
  ElectronSafeStorageAdapter: class {
    isAvailable = vi.fn(() => false)
    encrypt = vi.fn()
    decrypt = vi.fn()
    getBackendName = vi.fn(() => 'unknown')
  },
}))

describe('createSecureStorage', () => {
  it('falls back to local persistence when OS secure storage is unavailable', () => {
    const storage = createSecureStorage()
    expect(isFallbackSecureStorage(storage)).toBe(true)
    expect(storage.isAvailable()).toBe(true)
    expect(storage.getBackendName()).toBe('basic_text')
  })

  it('round-trips plaintext through the fallback adapter', () => {
    const storage = new FallbackSecureStorage()
    const encrypted = storage.encrypt('{"type":"password"}')
    expect(storage.decrypt(encrypted)).toBe('{"type":"password"}')
  })
})
