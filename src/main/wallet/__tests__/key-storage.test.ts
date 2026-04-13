/**
 * Unit tests for WalletKeyStorage.
 * Uses InMemorySecureStorage adapter instead of mocking electron safeStorage.
 */

import { promises as fs } from 'fs'
import type { ISecureStorage } from '../../ports/secure-storage'

// --- In-memory test adapter ---

class InMemorySecureStorage implements ISecureStorage {
  private available = true
  private backendName = 'test-backend'

  setAvailable(v: boolean): void {
    this.available = v
  }
  setBackendName(v: string): void {
    this.backendName = v
  }

  isAvailable(): boolean {
    return this.available
  }
  encrypt(plaintext: string): Buffer {
    return Buffer.from('ENC:' + plaintext)
  }
  decrypt(encrypted: Buffer): string {
    const str = encrypted.toString()
    if (!str.startsWith('ENC:')) throw new Error('Decryption failed')
    return str.slice(4)
  }
  getBackendName(): string {
    return this.backendName
  }
}

// --- Mocks ---

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    constants: actual.constants,
    promises: {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      access: vi.fn(),
      unlink: vi.fn(),
      copyFile: vi.fn(),
      rename: vi.fn(),
      chmod: vi.fn(),
    },
  }
})

vi.mock('@ton/crypto', () => ({
  mnemonicNew: vi.fn(() => Promise.resolve(Array(24).fill('test'))),
  mnemonicToPrivateKey: vi.fn(() =>
    Promise.resolve({
      publicKey: Buffer.alloc(32, 1),
      secretKey: Buffer.alloc(64, 2),
    })
  ),
  mnemonicValidate: vi.fn((words: string[]) => Promise.resolve(words.length === 24)),
  keyPairFromSeed: vi.fn(() => ({
    publicKey: Buffer.alloc(32, 1),
    secretKey: Buffer.alloc(64, 2),
  })),
}))

vi.mock('@ton/ton', () => ({
  WalletContractV5R1: {
    create: vi.fn(() => ({
      address: {
        toString: () => 'UQTest...',
        toRawString: () => '0:test...',
      },
    })),
  },
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test') },
}))

// Import after mocks
import { WalletKeyStorage, WalletDecryptionError } from '../key-storage'

// --- Helpers ---

const SENC_MARKER = Buffer.from('SENC')

function makeEncryptedBuffer(data: object, storage: InMemorySecureStorage): Buffer {
  const json = JSON.stringify(data)
  const encrypted = storage.encrypt(json)
  return Buffer.concat([SENC_MARKER, encrypted])
}

// --- Tests ---

describe('WalletKeyStorage', () => {
  let storage: InMemorySecureStorage
  let ks: WalletKeyStorage

  beforeEach(() => {
    vi.clearAllMocks()
    storage = new InMemorySecureStorage()
    ks = new WalletKeyStorage(storage, '/tmp/test')
    // Default: file does not exist
    vi.mocked(fs.access).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }))
  })

  // 1. generate() produces 24 words and stores encrypted
  describe('generate()', () => {
    it('produces 24-word mnemonic and writes encrypted file', async () => {
      const result = await ks.generate()

      expect(result.publicKey).toBeInstanceOf(Buffer)
      expect(result.publicKey.length).toBe(32)
      expect(result.secretKey).toBeInstanceOf(Buffer)
      expect(result.secretKey.length).toBe(64)

      expect(fs.writeFile).toHaveBeenCalledOnce()
      const [, written] = vi.mocked(fs.writeFile).mock.calls[0]
      const buf = written as Buffer
      // Starts with SENC marker
      expect(buf.subarray(0, 4).toString()).toBe('SENC')
    })

    it('generateFromMnemonic returns mnemonic array of length 24', async () => {
      const { mnemonic, keypair } = await ks.generateFromMnemonic()

      expect(mnemonic).toHaveLength(24)
      expect(keypair.publicKey).toBeInstanceOf(Buffer)
    })

    it('throws if wallet already exists', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined)
      await expect(ks.generateFromMnemonic()).rejects.toThrow('Wallet already exists')
    })

    it('throws if encryption is unavailable', async () => {
      storage.setAvailable(false)
      await expect(ks.generate()).rejects.toThrow('Secure storage is not available')
    })
  })

  // 2. importFromMnemonic validates and rejects invalid phrases
  describe('importFromMnemonic()', () => {
    it('imports valid 24-word mnemonic', async () => {
      const words = Array(24).fill('word')
      const result = await ks.importFromMnemonic(words)

      expect(result.publicKey.length).toBe(32)
      expect(result.secretKey.length).toBe(64)
      expect(fs.writeFile).toHaveBeenCalledOnce()
    })

    it('rejects invalid mnemonic (wrong length)', async () => {
      const words = Array(12).fill('word')
      await expect(ks.importFromMnemonic(words)).rejects.toThrow('Invalid mnemonic phrase')
    })

    it('throws if encryption is unavailable', async () => {
      storage.setAvailable(false)
      const words = Array(24).fill('word')
      await expect(ks.importFromMnemonic(words)).rejects.toThrow('Secure storage is not available')
    })
  })

  // 3. load() decrypts mnemonic format
  describe('load() - mnemonic format', () => {
    it('decrypts and returns keypair from mnemonic JSON', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      const result = await ks.load()

      expect(result.publicKey.length).toBe(32)
      expect(result.secretKey.length).toBe(64)
    })

    it('returns cached keypair on second call', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      await ks.load()
      await ks.load()

      // readFile only called once because second call uses cache
      expect(fs.readFile).toHaveBeenCalledOnce()
    })
  })

  // 4. load() migrates legacy seed format (32-byte raw Buffer without SENC marker)
  describe('load() - legacy seed migration', () => {
    it('reads 32-byte raw seed and migrates to encrypted format', async () => {
      const rawSeed = Buffer.alloc(32, 0xaa)
      const seedHex = rawSeed.toString('hex')

      // First readFile: returns raw seed; second readFile (verify): returns encrypted file
      const encryptedBuf = (() => {
        const json = JSON.stringify({ type: 'seed', seed: seedHex })
        const enc = storage.encrypt(json)
        return Buffer.concat([SENC_MARKER, enc])
      })()
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(rawSeed) // initial read
        .mockResolvedValueOnce(encryptedBuf) // verification read

      vi.mocked(fs.access).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' })) // no bak
      vi.mocked(fs.copyFile).mockResolvedValue(undefined)
      vi.mocked(fs.chmod).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.rename).mockResolvedValue(undefined)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      const result = await ks.load()

      expect(result.publicKey.length).toBe(32)
      expect(result.secretKey.length).toBe(64)
      // Backup was created
      expect(fs.copyFile).toHaveBeenCalledOnce()
      // New encrypted file was written (tmp) and renamed
      expect(fs.writeFile).toHaveBeenCalledOnce()
      expect(fs.rename).toHaveBeenCalledOnce()
      // Backup was removed after successful verification
      expect(fs.unlink).toHaveBeenCalledOnce()
    })

    it('reads legacy encrypted hex seed (SENC + non-JSON)', async () => {
      const seedHex = Buffer.alloc(32, 0xbb).toString('hex')
      const encrypted = storage.encrypt(seedHex)
      const buf = Buffer.concat([SENC_MARKER, encrypted])
      vi.mocked(fs.readFile).mockResolvedValue(buf)

      const result = await ks.load()

      expect(result.publicKey.length).toBe(32)
      expect(result.secretKey.length).toBe(64)
    })

    it('skips migration on basic_text backend', async () => {
      storage.setBackendName('basic_text')
      const rawSeed = Buffer.alloc(32, 0xaa)
      vi.mocked(fs.readFile).mockResolvedValue(rawSeed)

      const result = await ks.load()

      expect(result.publicKey.length).toBe(32)
      // Should NOT write because basic_text is weak
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it('preserves backup when verification fails after write', async () => {
      const rawSeed = Buffer.alloc(32, 0xaa)

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(rawSeed) // initial read
        .mockResolvedValueOnce(rawSeed) // verify read: still raw = verification fails

      vi.mocked(fs.access).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' })) // no bak
      vi.mocked(fs.copyFile).mockResolvedValue(undefined)
      vi.mocked(fs.chmod).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.rename).mockResolvedValue(undefined)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      // load() still returns the seed (from memory), migration failure is logged but non-fatal
      const result = await ks.load()
      expect(result.publicKey.length).toBe(32)

      // backup was created but NOT deleted (verification failed)
      expect(fs.copyFile).toHaveBeenCalledOnce()
      // unlink may be called for tmp cleanup but never for the bak path
      const unlinkCalls = vi.mocked(fs.unlink).mock.calls.map(([p]) => p as string)
      expect(unlinkCalls.every((p) => !p.endsWith('.pre-migration.bak'))).toBe(true)
    })

    it('removes stale backup and skips re-migration when main file is already valid', async () => {
      const rawSeed = Buffer.alloc(32, 0xaa)
      const seedHex = rawSeed.toString('hex')

      // Simulate: main file is already the encrypted version (migration succeeded previously)
      const encryptedBuf = (() => {
        const json = JSON.stringify({ type: 'seed', seed: seedHex })
        const enc = storage.encrypt(json)
        return Buffer.concat([SENC_MARKER, enc])
      })()

      // Initial readFile returns raw seed — but wait, that path is only for 32-byte buffers.
      // The bak-exists path calls verifySeedFile which reads the main file.
      // Here we simulate: readData returns raw 32 bytes, bak exists, main file is valid.
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(rawSeed) // initial readData read
        .mockResolvedValueOnce(encryptedBuf) // verifySeedFile read (main file already valid)

      // bak file exists
      vi.mocked(fs.access).mockResolvedValue(undefined)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      const result = await ks.load()
      expect(result.publicKey.length).toBe(32)

      // No new write — migration skipped because main file is already valid
      expect(fs.writeFile).not.toHaveBeenCalled()
      expect(fs.copyFile).not.toHaveBeenCalled()
      // Stale bak was removed
      expect(fs.unlink).toHaveBeenCalledOnce()
    })

    it('restores from backup and retries when main file is corrupt after interrupted migration', async () => {
      const rawSeed = Buffer.alloc(32, 0xcc)
      const seedHex = rawSeed.toString('hex')

      const encryptedBuf = (() => {
        const json = JSON.stringify({ type: 'seed', seed: seedHex })
        const enc = storage.encrypt(json)
        return Buffer.concat([SENC_MARKER, enc])
      })()

      // Sequence:
      //   readData: returns raw 32-byte buffer (the "corrupt" main file is still raw here for test simplicity)
      //   bak exists → verifySeedFile(main): returns raw bytes → verify fails
      //   copyFile(bak → main) [restore]
      //   copyFile(main → bak) [new backup]
      //   writeFile + rename (new encrypted)
      //   verifySeedFile(main): returns encrypted buffer → verify succeeds
      //   unlink(bak)
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(rawSeed) // readData initial
        .mockResolvedValueOnce(rawSeed) // verifySeedFile after bak detected → fail (still raw)
        .mockResolvedValueOnce(encryptedBuf) // verifySeedFile after write → success

      vi.mocked(fs.access).mockResolvedValue(undefined) // bak exists
      vi.mocked(fs.copyFile).mockResolvedValue(undefined)
      vi.mocked(fs.chmod).mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.rename).mockResolvedValue(undefined)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      const result = await ks.load()
      expect(result.publicKey.length).toBe(32)

      // restore from bak + new bak + encrypted write + bak unlink
      expect(fs.copyFile).toHaveBeenCalledTimes(2)
      expect(fs.writeFile).toHaveBeenCalledOnce()
      expect(fs.rename).toHaveBeenCalledOnce()
      expect(fs.unlink).toHaveBeenCalledOnce()
    })
  })

  // 5. load() throws WalletDecryptionError on decrypt failure
  describe('load() - decryption failure', () => {
    it('throws WalletDecryptionError when decrypt fails', async () => {
      // Buffer with SENC marker but garbage encrypted data (no ENC: prefix)
      const garbled = Buffer.concat([SENC_MARKER, Buffer.from('not-encrypted-data')])
      vi.mocked(fs.readFile).mockResolvedValue(garbled)

      await expect(ks.load()).rejects.toThrow(WalletDecryptionError)
    })

    it('throws on missing wallet file', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }))

      await expect(ks.load()).rejects.toThrow('No wallet data found')
    })
  })

  // 6. lock() zeros the secret key in memory
  describe('lock()', () => {
    it('clears secret key from memory', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      await ks.load()
      expect(ks.getPublicKey()).not.toBeNull()

      ks.lock()

      expect(ks.isLocked()).toBe(true)
      // Public key retained, secret key gone
      expect(ks.getPublicKey()).not.toBeNull()
    })

    it('is idempotent when called twice', () => {
      ks.lock()
      ks.lock()
      // No throw
      expect(ks.isLocked()).toBe(false) // no public key loaded either
    })
  })

  // 7. Auto-lock timer fires after timeout
  describe('auto-lock timer', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('locks wallet after auto-lock timeout', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      await ks.load()
      expect(ks.isLocked()).toBe(false)

      // Default auto-lock is 5 minutes (300000ms)
      vi.advanceTimersByTime(5 * 60 * 1000)

      expect(ks.isLocked()).toBe(true)
    })

    it('setAutoLockMinutes(0) disables auto-lock', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      await ks.load()
      ks.setAutoLockMinutes(0)

      vi.advanceTimersByTime(10 * 60 * 1000)

      expect(ks.isLocked()).toBe(false)
    })

    it('setAutoLockMinutes resets the timer with new duration', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      await ks.load()
      ks.setAutoLockMinutes(1) // 1 minute

      vi.advanceTimersByTime(60 * 1000)

      expect(ks.isLocked()).toBe(true)
    })
  })

  // 8. isBasicTextBackend() detects weak backend
  describe('isBasicTextBackend()', () => {
    it('returns true for basic_text backend', () => {
      storage.setBackendName('basic_text')
      expect(ks.isBasicTextBackend()).toBe(true)
    })

    it('returns false for other backends', () => {
      storage.setBackendName('gnome-keyring')
      expect(ks.isBasicTextBackend()).toBe(false)
    })

    it('returns false for default test-backend', () => {
      expect(ks.isBasicTextBackend()).toBe(false)
    })
  })

  // 9. exists() and deleteFile()
  describe('exists() and deleteFile()', () => {
    it('returns false when file does not exist', async () => {
      expect(await ks.exists()).toBe(false)
    })

    it('returns true when file exists', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined)
      expect(await ks.exists()).toBe(true)
    })

    it('deleteFile calls unlink', async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined)
      await ks.deleteFile()
      expect(fs.unlink).toHaveBeenCalledOnce()
    })

    it('deleteFile ignores ENOENT', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }))
      await expect(ks.deleteFile()).resolves.toBeUndefined()
    })

    it('deleteFile rethrows other errors', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
      await expect(ks.deleteFile()).rejects.toThrow('EPERM')
    })
  })

  // 10. getAddress() derives W5 v5r1 address
  describe('getAddress()', () => {
    it('derives wallet address from keypair', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      const { address, addressRaw } = await ks.getAddress()

      expect(address).toBe('UQTest...')
      expect(addressRaw).toBe('0:test...')
    })
  })

  // Additional: destroy() wipes all cached keys
  describe('destroy()', () => {
    it('wipes both public and secret keys', async () => {
      const data = { type: 'mnemonic', mnemonic: Array(24).fill('test') }
      vi.mocked(fs.readFile).mockResolvedValue(makeEncryptedBuffer(data, storage))

      await ks.load()
      ks.destroy()

      expect(ks.getPublicKey()).toBeNull()
      expect(ks.isLocked()).toBe(false) // both null, not locked
    })
  })
})
