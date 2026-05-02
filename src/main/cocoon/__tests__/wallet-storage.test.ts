import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/cocoon-test') },
}))

// Make exists() return true so update() gets past the existence check
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    promises: {
      ...(actual as any).promises,
      access: vi.fn(() => Promise.resolve()),
    },
  }
})

import { CocoonKeyStorage } from '../wallet-storage'
import type { ISecureStorage } from '../../ports/secure-storage'

function makeStorage(available: boolean): ISecureStorage {
  return {
    isAvailable: () => available,
    encrypt: vi.fn((s: string) => Buffer.from(s)),
    decrypt: vi.fn((b: Buffer) => b.toString()),
    getBackendName: () => 'mock',
  }
}

const MOCK_WALLET_DATA = {
  ownerMnemonic: ['word1', 'word2'],
  nodeSecretBase64: 'AAAA',
  nodePublicKeyHex: 'aabb',
  ownerAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  nodeAddress: 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k',
  createdAt: 1_700_000_000_000,
}

describe('CocoonKeyStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('update()', () => {
    it('throws when encryption is unavailable', async () => {
      const storage = new CocoonKeyStorage(makeStorage(false), '/tmp/cocoon-test')

      await expect(storage.update(MOCK_WALLET_DATA)).rejects.toThrow('Secure storage is not available')
    })
  })
})
