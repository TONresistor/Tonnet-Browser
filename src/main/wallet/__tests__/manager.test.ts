/**
 * Unit tests for WalletManager.resolveRecipient.
 * The bridge is injected through its provider; no network or Go binary required.
 */

import type { ISecureStorage } from '../../ports/secure-storage'
import type { DnsResolveResult } from '../../../shared/types'

// --- In-memory secure storage adapter ---

class InMemorySecureStorage implements ISecureStorage {
  isAvailable(): boolean {
    return true
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
    return 'test-backend'
  }
}

// --- Mocks (must be declared before imports that trigger them) ---

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    promises: {
      writeFile: vi.fn(),
      readFile: vi.fn(),
      access: vi.fn(),
      unlink: vi.fn(),
    },
  }
})

vi.mock('@ton/crypto', () => ({
  sign: vi.fn(() => Buffer.alloc(64, 6)),
  sha256_sync: vi.fn(() => Buffer.alloc(32, 5)),
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
        workChain: 0,
        hash: Buffer.alloc(32, 9),
        toString: () => 'UQTest...',
        toRawString: () => '0:test...',
      },
    })),
  },
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test') },
}))

vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    status: vi.fn(),
  }),
}))

vi.mock('../../settings', () => ({
  getSetting: vi.fn(() => ({ wsPort: 9999 })),
}))

// --- Import after mocks ---

import { WalletManager } from '../manager'
import { Address } from '@ton/core'

// --- Test constants ---

const VALID_ADDRESS = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const MASTERCHAIN_ADDRESS = '-1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
// Real non-bounceable address derived from VALID_ADDRESS — 48-char UQ... format
const UQ_ADDRESS = Address.parse(VALID_ADDRESS).toString({ bounceable: false })

function makeDnsResult(overrides: Partial<DnsResolveResult> = {}): DnsResolveResult {
  return {
    wallet: VALID_ADDRESS,
    site_adnl: null,
    has_storage: false,
    storage_bag_id: null,
    next_resolver: null,
    owner: null,
    nft_address: null,
    collection: null,
    editor: null,
    initialized: true,
    expiring_at: null,
    ...overrides,
  }
}

// --- Test suite ---

describe('WalletManager.resolveRecipient', () => {
  let manager: WalletManager
  let mockResolveDomain: ReturnType<typeof vi.fn>
  let bridge: { resolveDomain: ReturnType<typeof vi.fn> } | null

  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveDomain = vi.fn()
    bridge = { resolveDomain: mockResolveDomain }
    manager = new WalletManager(new InMemorySecureStorage(), {
      getBridge: () => bridge as never,
      onBridgeChanged: () => () => {},
    })
  })

  // --- Raw address pass-through ---

  it('passes through a valid raw 0: address unchanged', async () => {
    const result = await manager.resolveRecipient(VALID_ADDRESS)
    expect(result).toEqual({ address: VALID_ADDRESS })
    expect(mockResolveDomain).not.toHaveBeenCalled()
  })

  it('passes through a real UQ-format address unchanged', async () => {
    // UQ_ADDRESS is a valid 48-char base64url non-bounceable address; must survive
    // the raw-address path without corruption (toLowerCase is NOT applied to raw inputs)
    const result = await manager.resolveRecipient(UQ_ADDRESS)
    expect(result).toEqual({ address: UQ_ADDRESS })
    expect(mockResolveDomain).not.toHaveBeenCalled()
  })

  it('rejects a masterchain raw address', async () => {
    await expect(manager.resolveRecipient(MASTERCHAIN_ADDRESS)).rejects.toThrow('Masterchain addresses not supported')
  })

  it('normalizes whitespace before raw address parsing', async () => {
    const result = await manager.resolveRecipient('  ' + VALID_ADDRESS + '  ')
    expect(result).toEqual({ address: VALID_ADDRESS })
  })

  // --- Domain resolution ---

  it('resolves alice.ton using the wallet record', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult({ wallet: VALID_ADDRESS }))
    const result = await manager.resolveRecipient('alice.ton')
    expect(result).toEqual({ address: VALID_ADDRESS, domain: 'alice.ton' })
    expect(mockResolveDomain).toHaveBeenCalledWith('alice.ton')
  })

  it('falls back to owner when wallet record is absent', async () => {
    const ownerAddr = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    mockResolveDomain.mockResolvedValue(makeDnsResult({ wallet: null, owner: ownerAddr }))
    const result = await manager.resolveRecipient('alice.ton')
    expect(result).toEqual({ address: ownerAddr, domain: 'alice.ton' })
  })

  it('rejects when neither wallet nor owner is present', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult({ wallet: null, owner: null }))
    await expect(manager.resolveRecipient('alice.ton')).rejects.toThrow('Domain has no wallet or owner')
  })

  it('rejects when domain is not initialized', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult({ initialized: false }))
    await expect(manager.resolveRecipient('alice.ton')).rejects.toThrow('Domain not initialized')
  })

  it('rejects when domain has expiring_at in the past', async () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600
    mockResolveDomain.mockResolvedValue(makeDnsResult({ expiring_at: pastTimestamp }))
    await expect(manager.resolveRecipient('alice.ton')).rejects.toThrow('Domain expired')
  })

  it('does not reject when domain has expiring_at in the future', async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400
    mockResolveDomain.mockResolvedValue(makeDnsResult({ expiring_at: futureTimestamp }))
    const result = await manager.resolveRecipient('alice.ton')
    expect(result.domain).toBe('alice.ton')
  })

  it('resolves a numeric domain (1312.ton)', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult())
    const result = await manager.resolveRecipient('1312.ton')
    expect(result).toEqual({ address: VALID_ADDRESS, domain: '1312.ton' })
  })

  it('resolves a sub-domain (foo.alice.ton)', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult())
    const result = await manager.resolveRecipient('foo.alice.ton')
    expect(result).toEqual({ address: VALID_ADDRESS, domain: 'foo.alice.ton' })
  })

  it('lowercases ALICE.TON before resolving', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult())
    const result = await manager.resolveRecipient('ALICE.TON')
    expect(result.domain).toBe('alice.ton')
    expect(mockResolveDomain).toHaveBeenCalledWith('alice.ton')
  })

  it('normalizes whitespace around a domain', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult())
    const result = await manager.resolveRecipient('  alice.ton  ')
    expect(result.domain).toBe('alice.ton')
  })

  // --- Security: non-ASCII rejection ---

  it('rejects a domain with non-ASCII characters (homograph prevention)', async () => {
    await expect(manager.resolveRecipient('caf\u00e9.ton')).rejects.toThrow('Non-ASCII domain not allowed')
    expect(mockResolveDomain).not.toHaveBeenCalled()
  })

  // --- Domain format validation ---

  it('rejects a label starting with a hyphen', async () => {
    await expect(manager.resolveRecipient('-alice.ton')).rejects.toThrow('Invalid domain format')
  })

  it('rejects a label ending with a hyphen', async () => {
    await expect(manager.resolveRecipient('alice-.ton')).rejects.toThrow('Invalid domain format')
  })

  it('rejects a domain exceeding 126 characters', async () => {
    // 64-char label + .ton = 68; repeat to exceed 126
    const longDomain = 'a'.repeat(63) + '.' + 'b'.repeat(56) + '.ton'
    await expect(manager.resolveRecipient(longDomain)).rejects.toThrow()
  })

  // --- Non-.ton TLD falls through to raw address parse ---

  it('treats alice.eth as a raw address (parse fails)', async () => {
    await expect(manager.resolveRecipient('alice.eth')).rejects.toThrow()
    expect(mockResolveDomain).not.toHaveBeenCalled()
  })

  // --- Masterchain result from DNS ---

  it('rejects a domain that resolves to a masterchain address', async () => {
    mockResolveDomain.mockResolvedValue(makeDnsResult({ wallet: MASTERCHAIN_ADDRESS }))
    await expect(manager.resolveRecipient('alice.ton')).rejects.toThrow('Masterchain addresses not supported')
  })

  // --- Bridge disconnected ---

  it('throws Bridge not connected when the provider has no bridge', async () => {
    bridge = null
    await expect(manager.resolveRecipient('alice.ton')).rejects.toThrow('Bridge not connected')
  })

  it('throws Domain not registered when the bridge call rejects', async () => {
    mockResolveDomain.mockRejectedValue(new Error('RPC error: domain not found'))
    await expect(manager.resolveRecipient('alice.ton')).rejects.toThrow('Domain not registered')
  })
})

describe('WalletManager recovery safety', () => {
  it('requires an application password for every newly created wallet', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const state = manager as unknown as { initialized: boolean }
    state.initialized = true
    await expect(manager.create({})).rejects.toThrow('wallet password is required')
  })

  it('never deletes an unreadable wallet when create is requested', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const state = manager as unknown as {
      initialized: boolean
      decryptFailed: boolean
      keyStorage: { deleteFile: ReturnType<typeof vi.fn> }
    }
    state.initialized = true
    state.decryptFailed = true
    state.keyStorage = { deleteFile: vi.fn() }

    await expect(manager.create({ password: 'correct horse battery staple' })).rejects.toThrow(
      'Recover or explicitly delete'
    )
    expect(state.keyStorage.deleteFile).not.toHaveBeenCalled()
  })

  it('never replaces a wallet while system storage is blocked', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const state = manager as unknown as {
      initialized: boolean
      systemStorageBlocked: boolean
      keyStorage: { deleteFile: ReturnType<typeof vi.fn> }
    }
    state.initialized = true
    state.systemStorageBlocked = true
    state.keyStorage = { deleteFile: vi.fn() }

    await expect(manager.create({ password: 'correct horse battery staple' })).rejects.toThrow(
      'Unlock system secure storage'
    )
    expect(state.keyStorage.deleteFile).not.toHaveBeenCalled()
  })
})

describe('WalletManager vault mutation safety', () => {
  function prepareVaultMutation(manager: WalletManager) {
    const keypair = { publicKey: Buffer.alloc(32, 7), secretKey: Buffer.alloc(64, 8) }
    const keyStorage = {
      protectWithPassword: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({ backupVerified: false }),
      changePassword: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(keypair),
      lock: vi.fn(),
      isLocked: vi.fn(() => false),
    }
    const state = manager as unknown as {
      operationTail: Promise<void>
      publicKey: Buffer
      keypair: TestKeypair | null
      keyStorage: typeof keyStorage
    }
    state.publicKey = Buffer.from(keypair.publicKey)
    state.keypair = keypair
    state.keyStorage = keyStorage
    return { state, keyStorage }
  }

  it('queues password setup behind active wallet operations', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const { state, keyStorage } = prepareVaultMutation(manager)
    let release: () => void = () => {}
    state.operationTail = new Promise<void>((resolve) => {
      release = resolve
    })

    const setup = manager.setupPassword('correct horse battery staple')
    await Promise.resolve()
    expect(keyStorage.protectWithPassword).not.toHaveBeenCalled()

    release()
    await setup
    expect(keyStorage.protectWithPassword).toHaveBeenCalledOnce()
  })

  it('serializes concurrent password changes', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const { keyStorage } = prepareVaultMutation(manager)
    let releaseFirst: () => void = () => {}
    keyStorage.changePassword
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      )
      .mockResolvedValueOnce(undefined)

    const first = manager.changePassword('current password value', 'next password value')
    await Promise.resolve()
    const second = manager.changePassword('next password value', 'final password value')
    await Promise.resolve()
    expect(keyStorage.changePassword).toHaveBeenCalledOnce()

    releaseFirst()
    await first
    await second
    expect(keyStorage.changePassword).toHaveBeenCalledTimes(2)
  })
})

type TestKeypair = { publicKey: Buffer; secretKey: Buffer }

interface WalletManagerImportState {
  initialized: boolean
  operationTail: Promise<void>
  keypair: TestKeypair | null
  publicKey: Buffer | null
  walletContract: unknown
  keyStorage: {
    importFromMnemonic: ReturnType<typeof vi.fn>
    deleteFile: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    isBasicTextBackend: ReturnType<typeof vi.fn>
    isLocked: ReturnType<typeof vi.fn>
    load: ReturnType<typeof vi.fn>
    lock: ReturnType<typeof vi.fn>
  }
  runtime: {
    balance: string
    resetAccount: ReturnType<typeof vi.fn>
  }
}

function prepareWalletImport(manager: WalletManager, importFromMnemonic: ReturnType<typeof vi.fn>) {
  const oldKeypair = { publicKey: Buffer.alloc(32, 3), secretKey: Buffer.alloc(64, 4) }
  const oldPublicKey = Buffer.alloc(32, 5)
  const stop = vi.fn()
  const keyStorage = {
    importFromMnemonic,
    deleteFile: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    isBasicTextBackend: vi.fn(() => false),
    isLocked: vi.fn(() => false),
    load: vi.fn(),
    lock: vi.fn(),
  }
  const state = manager as unknown as WalletManagerImportState
  state.initialized = true
  state.keypair = oldKeypair
  state.publicKey = oldPublicKey
  state.walletContract = {
    address: { toString: () => 'UQOld', toRawString: () => '0:old' },
  }
  state.keyStorage = keyStorage
  state.runtime = { balance: '0', resetAccount: stop }
  return { state, oldKeypair, oldPublicKey, keyStorage, stop }
}

describe('WalletManager.importWallet', () => {
  it('requires an application password before replacing or importing an account', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const input = Array(24).fill('word')
    const setup = prepareWalletImport(manager, vi.fn())
    await expect(manager.importWallet(input)).rejects.toThrow('wallet password is required')
    expect(setup.keyStorage.importFromMnemonic).not.toHaveBeenCalled()
  })

  it.each(['Invalid mnemonic phrase', 'Disk write failed'])(
    'preserves the current wallet when import fails: %s',
    async (message) => {
      const manager = new WalletManager(new InMemorySecureStorage())
      const input = Array(24).fill('word')
      const setup = prepareWalletImport(manager, vi.fn().mockRejectedValue(new Error(message)))

      await expect(manager.importWallet(input, 'correct horse battery staple')).rejects.toThrow(message)

      expect(setup.state.keypair).toBe(setup.oldKeypair)
      expect(setup.state.publicKey).toBe(setup.oldPublicKey)
      expect(setup.oldKeypair.publicKey.every((value) => value === 3)).toBe(true)
      expect(setup.oldKeypair.secretKey.every((value) => value === 4)).toBe(true)
      expect(setup.oldPublicKey.every((value) => value === 5)).toBe(true)
      expect(setup.stop).not.toHaveBeenCalled()
      expect(setup.keyStorage.deleteFile).not.toHaveBeenCalled()
      expect(setup.keyStorage.destroy).not.toHaveBeenCalled()
      expect(input).toHaveLength(0)
    }
  )

  it('switches wallets only after the replacement is persisted', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const input = Array(24).fill('word')
    const nextKeypair = { publicKey: Buffer.alloc(32, 7), secretKey: Buffer.alloc(64, 8) }
    const importFromMnemonic = vi.fn().mockResolvedValue(nextKeypair)
    const setup = prepareWalletImport(manager, importFromMnemonic)

    const result = await manager.importWallet(input, 'correct horse battery staple')

    expect(importFromMnemonic).toHaveBeenCalledOnce()
    expect(setup.stop).toHaveBeenCalledOnce()
    expect(setup.state.keypair).toBe(nextKeypair)
    expect(setup.state.publicKey).toEqual(nextKeypair.publicKey)
    expect(setup.state.publicKey).not.toBe(nextKeypair.publicKey)
    expect(setup.oldKeypair.publicKey.every((value) => value === 0)).toBe(true)
    expect(setup.oldKeypair.secretKey.every((value) => value === 0)).toBe(true)
    expect(setup.oldPublicKey.every((value) => value === 0)).toBe(true)
    expect(setup.keyStorage.deleteFile).not.toHaveBeenCalled()
    expect(setup.keyStorage.destroy).not.toHaveBeenCalled()
    expect(input).toHaveLength(0)
    expect(result.isCreated).toBe(true)
  })

  it('waits for an active signing operation before importing', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const input = Array(24).fill('word')
    const nextKeypair = { publicKey: Buffer.alloc(32, 7), secretKey: Buffer.alloc(64, 8) }
    const importFromMnemonic = vi.fn().mockResolvedValue(nextKeypair)
    const setup = prepareWalletImport(manager, importFromMnemonic)
    let release: () => void = () => {}
    setup.state.operationTail = new Promise<void>((resolve) => {
      release = resolve
    })

    const result = manager.importWallet(input, 'correct horse battery staple')
    await Promise.resolve()

    expect(importFromMnemonic).not.toHaveBeenCalled()

    release()
    await result

    expect(importFromMnemonic).toHaveBeenCalledOnce()
  })

  it('serializes concurrent imports', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const firstInput = Array(24).fill('first')
    const secondInput = Array(24).fill('second')
    const firstKeypair = { publicKey: Buffer.alloc(32, 7), secretKey: Buffer.alloc(64, 8) }
    const secondKeypair = { publicKey: Buffer.alloc(32, 9), secretKey: Buffer.alloc(64, 10) }
    let resolveFirst: (keypair: TestKeypair) => void = () => {}
    const firstImport = new Promise<TestKeypair>((resolve) => {
      resolveFirst = resolve
    })
    const importFromMnemonic = vi.fn().mockReturnValueOnce(firstImport).mockResolvedValueOnce(secondKeypair)
    const setup = prepareWalletImport(manager, importFromMnemonic)

    const firstResult = manager.importWallet(firstInput, 'correct horse battery staple')
    await Promise.resolve()
    const secondResult = manager.importWallet(secondInput, 'correct horse battery staple')
    await Promise.resolve()

    expect(importFromMnemonic).toHaveBeenCalledOnce()

    resolveFirst(firstKeypair)
    await firstResult
    await secondResult

    expect(importFromMnemonic).toHaveBeenCalledTimes(2)
    expect(setup.state.keypair).toBe(secondKeypair)
  })

  it('does not read the previous account while an import is pending', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const input = Array(24).fill('word')
    const nextKeypair = { publicKey: Buffer.alloc(32, 7), secretKey: Buffer.alloc(64, 8) }
    let resolveImport: (keypair: TestKeypair) => void = () => {}
    const pendingImport = new Promise<TestKeypair>((resolve) => {
      resolveImport = resolve
    })
    const setup = prepareWalletImport(manager, vi.fn().mockReturnValue(pendingImport))
    const readPreviousAccount = vi.fn()
    setup.state.walletContract = {
      address: {
        get workChain() {
          readPreviousAccount()
          return 0
        },
        hash: Buffer.alloc(32, 3),
        toString: () => 'UQOld',
        toRawString: () => '0:old',
      },
    }

    const importing = manager.importWallet(input, 'correct horse battery staple')
    await Promise.resolve()
    const signing = manager.signData('example.ton', { type: 'text', text: 'Approve' })
    await Promise.resolve()
    const readsBeforeImport = readPreviousAccount.mock.calls.length

    resolveImport(nextKeypair)
    await importing
    const signed = await signing

    expect(readsBeforeImport).toBe(0)
    expect(readPreviousAccount).not.toHaveBeenCalled()
    expect(signed.address).toBe('0:test...')
  })

  it('rejects an approved signing request when the wallet changes before signing', async () => {
    const manager = new WalletManager(new InMemorySecureStorage())
    const input = Array(24).fill('word')
    const nextKeypair = { publicKey: Buffer.alloc(32, 7), secretKey: Buffer.alloc(64, 8) }
    let resolveImport: (keypair: TestKeypair) => void = () => {}
    const pendingImport = new Promise<TestKeypair>((resolve) => {
      resolveImport = resolve
    })
    const setup = prepareWalletImport(manager, vi.fn().mockReturnValue(pendingImport))
    const approvedAddress = `0:${'11'.repeat(32)}`
    setup.state.walletContract = {
      address: {
        toString: () => 'UQOld',
        toRawString: () => approvedAddress,
      },
    }

    const importing = manager.importWallet(input, 'correct horse battery staple')
    await Promise.resolve()
    const signing = manager.signData('example.ton', { type: 'text', text: 'Approve' }, approvedAddress)
    resolveImport(nextKeypair)

    await importing
    await expect(signing).rejects.toThrow('Wallet changed while approval was pending')
  })
})
