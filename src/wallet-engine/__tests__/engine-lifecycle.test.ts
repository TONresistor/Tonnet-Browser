import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mnemonicNew, keyPairFromSeed } from '@ton/crypto'
import { Address, Cell, loadOutList, loadMessage } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import type { WalletBridgePort } from '../bridge-port'
import { WalletEngine, type WalletEngineOptions } from '../engine'
import { deriveWalletAccount } from '../wallet-versions'
import { WalletHistoryManager } from '../history'
import type { JournalStore, SecureStorage, VaultPersistence } from '../ports'
import { writeSecureFileAtomic } from '../../main/utils/secure-fs'
import {
  deleteWalletStorage,
  getWalletStorageFingerprint,
  quarantineWalletStorage,
} from '../../main/wallet/wallet-storage-quarantine'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})
async function fixture(
  financial = false,
  overrides: Partial<WalletEngineOptions> = {},
  mapVault?: (vault: VaultPersistence) => VaultPersistence
) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'wallet-engine-lifecycle-'))
  directories.push(directory)
  const filePath = join(directory, 'wallet-key.dat')
  const secure: SecureStorage = {
    isAvailable: () => true,
    getBackendName: () => 'basic_text',
    encrypt: (text) => Buffer.from('ENC:' + text),
    decrypt: (bytes) => {
      const value = bytes.toString()
      if (!value.startsWith('ENC:')) throw new Error('Corrupt platform storage')
      return value.slice(4)
    },
  }
  const vault: VaultPersistence = {
    filePath,
    files: fs,
    writeAtomic: writeSecureFileAtomic,
    delete: deleteWalletStorage,
    fingerprint: getWalletStorageFingerprint,
    quarantine: quarantineWalletStorage,
  }
  const records = new Map<string, Buffer>()
  let failJournal = false
  const journal: JournalStore = {
    read: async (account) => {
      if (failJournal) throw new Error('Disk unavailable')
      return records.get(account) ?? null
    },
    compareExchange: async (account, revision, bytes) => {
      const current = records.get(account)
      if ((current ? JSON.parse(current.toString()).revision : 0) !== revision) throw new Error('Conflict')
      records.set(account, Buffer.from(bytes))
    },
  }
  const block = {
    workchain: 0,
    shard: '8000000000000000',
    seqno: 1,
    root_hash: '00'.repeat(32),
    file_hash: '00'.repeat(32),
  }
  const provider = {
    getBalance: vi.fn(async () => '100000000000'),
    getTransactions: vi.fn(async () => []),
    getRawTransactions: async () => [],
    subscribeAccountState: vi.fn(() => () => {}),
    subscribeTransactions: () => () => {},
    getWalletSnapshot: async () => ({
      address: engine.getState().address,
      balance: '100000000000',
      status: 'uninit' as const,
      seqno: 0,
      last_tx_lt: '0',
      last_tx_hash: '',
      block_time: 1000,
      block,
      masterchain: { ...block, workchain: -1 },
    }),
    getAccountInformation: async () => ({ balance: '100000000000', status: 'active' as const }),
    emulateTransaction: vi.fn(async () => ({ accepted: true, success: true, exit_code: 0, total_fees: '100' })),
    runMethod: async () => ({
      stack: [BigInt('0x' + keyPairFromSeed(Buffer.alloc(32, 8)).publicKey.toString('hex')).toString()],
    }),
    broadcast: vi.fn(async () => {}),
    sendAndWatch: vi.fn(async () => 'confirmed-hint'),
  } as unknown as WalletBridgePort
  const options = {
    secureStorage: secure,
    vault: mapVault?.(vault) ?? vault,
    journal,
    bridge: { getBridge: () => (financial ? provider : null), onBridgeChanged: () => () => {} },
    history: new WalletHistoryManager({ read: async () => null, write: async () => {}, delete: async () => {} }),
  }
  Object.assign(options, overrides)
  const engine: WalletEngine = new WalletEngine(options)
  return {
    engine,
    options,
    provider,
    filePath,
    fail: () => {
      failJournal = true
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function pauseLegacyRead() {
  const reading = deferred<void>()
  const release = deferred<void>()
  let first = true
  let filePath = ''
  const readFile = vi.fn(async (...args: Parameters<typeof fs.readFile>) => {
    const value = await fs.readFile(...args)
    if (first && String(args[0]) === filePath) {
      first = false
      reading.resolve()
      await release.promise
    }
    return value
  })
  const s = await fixture(false, {}, (vault) => {
    filePath = vault.filePath
    return { ...vault, files: { ...fs, readFile: readFile as typeof fs.readFile } }
  })
  await fs.writeFile(s.filePath, Buffer.alloc(32, 0x31), { mode: 0o600 })
  s.options.secureStorage.getBackendName = () => 'test-keychain'
  return { s, reading, release, readFile }
}
describe('wallet lifecycle with real cryptography and no Electron', () => {
  it('keeps backup challenges single-use and invalidates them on lock', async () => {
    const s = await fixture()
    try {
      const created = await s.engine.create({ password: 'correct horse battery staple' })
      const challenge = await s.engine.createBackupChallenge('correct horse battery staple')
      s.engine.lock()
      await expect(
        s.engine.verifyBackup(
          challenge.challengeId,
          'correct horse battery staple',
          challenge.indexes.map((index) => created.mnemonic[index])
        )
      ).rejects.toThrow('do not match')
      await s.engine.unlock('correct horse battery staple')
      const fresh = await s.engine.createBackupChallenge('correct horse battery staple')
      expect(
        (
          await s.engine.verifyBackup(
            fresh.challengeId,
            'correct horse battery staple',
            fresh.indexes.map((index) => created.mnemonic[index])
          )
        ).backupVerified
      ).toBe(true)
      await expect(
        s.engine.verifyBackup(
          fresh.challengeId,
          'correct horse battery staple',
          fresh.indexes.map((index) => created.mnemonic[index])
        )
      ).rejects.toThrow('do not match')
      created.mnemonic.fill('')
    } finally {
      await s.engine.shutdown()
    }
  })
  it('validates the replacement journal before changing the active vault', async () => {
    const s = await fixture()
    try {
      const created = await s.engine.create({ password: 'correct horse battery staple' })
      const before = await fs.readFile(s.filePath)
      const publicKey = s.engine.getState().publicKey
      s.fail()
      await expect(s.engine.importWallet(await mnemonicNew(24), 'replacement wallet password')).rejects.toThrow(
        'protected operation journal'
      )
      expect(s.engine.getState().publicKey).toBe(publicKey)
      expect(
        createHash('sha256')
          .update(await fs.readFile(s.filePath))
          .digest('hex')
      ).toBe(createHash('sha256').update(before).digest('hex'))
      created.mnemonic.fill('')
    } finally {
      await s.engine.shutdown()
    }
  })
  it('keeps a password-protected wallet locked across restart', async () => {
    const s = await fixture()
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    created.mnemonic.fill('')
    await s.engine.shutdown()
    const reopened = new WalletEngine(s.options)
    try {
      await reopened.init()
      expect(reopened.getState().isLocked).toBe(true)
      await reopened.unlock('correct horse battery staple')
      expect(reopened.getState().publicKey).toBe(created.publicKey)
    } finally {
      await reopened.shutdown()
    }
  })
})

it('invalidates a queued signature when the same phrase is imported again', async () => {
  const s = await fixture()
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const session = s.engine.getSessionRevision()
    const importing = s.engine.importWallet([...created.mnemonic], 'replacement wallet password')
    const signing = s.engine.signData('app.ton', { type: 'text', text: 'ownership' }, created.addressRaw, session)
    const rejection = expect(signing).rejects.toThrow('Wallet session changed')
    await importing
    await rejection
    expect(s.engine.getState().addressRaw).toBe(created.addressRaw)
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('restores the previous vault if a replacement write fails after rename', async () => {
  const s = await fixture()
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const before = await fs.readFile(s.filePath)
    const original = s.options.vault.writeAtomic
    let failed = false
    s.options.vault.writeAtomic = async (path, bytes) => {
      await original(path, bytes)
      if (!failed) {
        failed = true
        throw new Error('Lost durable-write acknowledgement')
      }
    }
    await expect(s.engine.importWallet(await mnemonicNew(24), 'replacement wallet password')).rejects.toThrow()
    expect(await fs.readFile(s.filePath)).toEqual(before)
    expect(s.engine.getState().publicKey).toBe(created.publicKey)
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('does not reopen a queued unlock after a later explicit lock', async () => {
  const s = await fixture()
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const authentication = s.engine.authenticatePassword('correct horse battery staple')
    const opening = s.engine.unlock('correct horse battery staple')
    const rejected = expect(opening).rejects.toThrow('Wallet session changed')
    s.engine.lock()
    await authentication
    await rejected
    expect(s.engine.getState().isLocked).toBe(true)
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('does not let a cancelled unlock invalidate a newer queued unlock', async () => {
  const legacy = deferred<Record<string, { seqno: number; validUntil: number }>>()
  const readLegacy = vi.fn(async (): Promise<Record<string, { seqno: number; validUntil: number }>> => ({}))
  const s = await fixture(false, { legacyPending: readLegacy })
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    created.mnemonic.fill('')
    s.engine.lock()
    readLegacy.mockReturnValueOnce(legacy.promise)
    const opened = vi.fn(() => s.engine.getState().isLocked)
    s.engine.on('journal-opened', opened)
    const rejected = expect(s.engine.unlock('correct horse battery staple')).rejects.toThrow('session changed')
    await vi.waitFor(() => expect(readLegacy).toHaveBeenCalledTimes(2))
    s.engine.lock()
    const latest = s.engine.unlock('correct horse battery staple')
    legacy.resolve({})
    await rejected
    expect((await latest).isLocked).toBe(false)
    expect(opened.mock.results.map((result) => result.value)).toEqual([false])
  } finally {
    legacy.resolve({})
    await s.engine.shutdown()
  }
}, 20_000)

it('does not lose an accepted payment when the same phrase is imported concurrently', async () => {
  const legacy = deferred<Record<string, { seqno: number; validUntil: number }>>()
  const readLegacy = vi.fn(async (): Promise<Record<string, { seqno: number; validUntil: number }>> => ({}))
  const s = await fixture(true, { legacyPending: readLegacy })
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    await s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    const reads = readLegacy.mock.calls.length
    readLegacy.mockReturnValueOnce(legacy.promise)
    const replacing = s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    await vi.waitFor(() => expect(readLegacy).toHaveBeenCalledTimes(reads + 1))
    let operation: Awaited<ReturnType<WalletEngine['signForRelay']>> | undefined
    try {
      operation = await s.engine.signForRelay(
        { operationId: 'during-import', context: 'x402', messages: [{ address: '0:' + '22'.repeat(32), amount: '5' }] },
        async () => true
      )
    } catch (error) {
      expect(error).toMatchObject({ code: 'SEND_IN_PROGRESS' })
    }
    legacy.resolve({})
    await replacing
    if (operation) expect(s.engine.getOperation(operation.id)?.boc).toBe(operation.boc)
    else expect(s.engine.getOperation('during-import')).toBeUndefined()
    created.mnemonic.fill('')
  } finally {
    legacy.resolve({})
    await s.engine.shutdown()
  }
}, 20_000)

it('settles an old signed-message write before reading the replacement journal', async () => {
  const s = await fixture(true)
  const writing = deferred<void>()
  const release = deferred<void>()
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    await s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    const original = s.options.journal.compareExchange.bind(s.options.journal)
    let writes = 0
    vi.spyOn(s.options.journal, 'compareExchange').mockImplementation(async (...args) => {
      if (++writes === 2) {
        writing.resolve()
        await release.promise
      }
      await original(...args)
    })
    const sending = s.engine
      .signForRelay(
        { operationId: 'old-write', messages: [{ address: '0:' + '22'.repeat(32), amount: '5' }] },
        async () => true
      )
      .then(
        (operation) => ({ operation }),
        (error: unknown) => ({ error })
      )
    await writing.promise
    const read = vi.spyOn(s.options.journal, 'read')
    const session = s.engine.getSessionRevision()
    let settled = false
    const replacing = s.engine.importWallet([...created.mnemonic], 'correct horse battery staple').then(
      (state) => {
        settled = true
        return { state }
      },
      (error: unknown) => {
        settled = true
        return { error }
      }
    )
    try {
      await vi.waitFor(() => expect(s.engine.getSessionRevision()).toBeGreaterThan(session), { timeout: 5000 })
      expect(settled).toBe(false)
      expect(read).not.toHaveBeenCalled()
    } finally {
      release.resolve()
    }
    expect(await replacing).toMatchObject({ state: { publicKey: created.publicKey } })
    expect(await sending).toMatchObject({ error: expect.any(Error) })
    expect(s.engine.getOperation('old-write')).toMatchObject({
      phase: 'handed-off',
      closed: false,
      boc: expect.any(String),
    })
    created.mnemonic.fill('')
  } finally {
    release.resolve()
    await s.engine.shutdown()
  }
}, 20_000)

it('keeps the previous unlocked wallet usable after a rejected replacement', async () => {
  const s = await fixture(true)
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    await s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    const operation = await s.engine.signForRelay(
      { operationId: 'retained', messages: [{ address: '0:' + '22'.repeat(32), amount: '5' }] },
      async () => true
    )
    s.fail()
    await expect(s.engine.importWallet([...created.mnemonic], 'replacement wallet password')).rejects.toThrow(
      'protected operation journal'
    )
    expect(s.engine.getState()).toMatchObject({ publicKey: created.publicKey, isLocked: false })
    expect(s.engine.getOperation(operation.id)?.boc).toBe(operation.boc)
    await expect(s.engine.signData('app.ton', { type: 'text', text: 'ownership' })).resolves.toMatchObject({
      address: created.addressRaw,
      signature: expect.any(String),
    })
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('shares startup initialization with import so a late legacy migration cannot overwrite the imported vault', async () => {
  const paused = await pauseLegacyRead()
  const { s } = paused
  const words = await mnemonicNew(24)
  const password = 'correct horse battery staple'
  let initializing: Promise<void> | undefined
  let importing: Promise<unknown> | undefined
  try {
    initializing = s.engine.init()
    await paused.reading.promise
    importing = s.engine.importWallet([...words], password)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(paused.readFile).toHaveBeenCalledOnce()
    paused.release.resolve()
    await initializing
    await importing
    const exported = await s.engine.exportMnemonic(password)
    try {
      expect(exported.mnemonic).toEqual(words)
      const account = await deriveWalletAccount(exported.mnemonic, 'v5R1')
      expect(s.engine.getState()).toMatchObject({ addressRaw: account.addressRaw, needsPasswordSetup: false })
    } finally {
      exported.mnemonic.fill('')
    }
  } finally {
    paused.release.resolve()
    await initializing
    await importing
    await s.engine.shutdown()
    words.fill('')
  }
}, 20_000)

it('drains initialization storage before shutdown releases the profile and never restores a closed identity', async () => {
  const paused = await pauseLegacyRead()
  const { s } = paused
  const words = await mnemonicNew(24)
  const password = 'correct horse battery staple'
  const reopened = new WalletEngine({ ...s.options, vault: { ...s.options.vault, files: fs } })
  let initializing: Promise<unknown> | undefined
  let stopping: Promise<void> | undefined
  try {
    initializing = s.engine.init().then(
      () => ({}),
      (error: unknown) => ({ error })
    )
    await paused.reading.promise
    const finished = vi.fn()
    stopping = s.engine.shutdown().then(finished)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(finished).not.toHaveBeenCalled()
    paused.release.resolve()
    expect(await initializing).toMatchObject({ error: { code: 'SHUTDOWN' } })
    await stopping
    expect(s.engine.getIdentitySnapshot()).toBeNull()
    expect(s.engine.getState().isCreated).toBe(false)
    await reopened.init()
    await reopened.importWallet([...words], password)
    const exported = await reopened.exportMnemonic(password)
    expect(exported.mnemonic).toEqual(words)
    exported.mnemonic.fill('')
  } finally {
    paused.release.resolve()
    await initializing
    await stopping
    await s.engine.shutdown()
    await reopened.shutdown()
    words.fill('')
  }
}, 20_000)

it('finishes shutdown without waiting for network warmup and rejects its late initialization response', async () => {
  const s = await fixture(true)
  const pending = deferred<string>()
  const reading = deferred<void>()
  let reopened: WalletEngine | undefined
  let initializing: Promise<unknown> | undefined
  let stopping: Promise<void> | undefined
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    created.mnemonic.fill('')
    await s.engine.shutdown()
    vi.mocked(s.provider.getBalance).mockImplementationOnce(() => {
      reading.resolve()
      return pending.promise
    })
    reopened = new WalletEngine(s.options)
    initializing = reopened.init().then(
      () => ({}),
      (error: unknown) => ({ error })
    )
    await reading.promise
    const finished = vi.fn()
    stopping = reopened.shutdown().then(finished)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(finished).toHaveBeenCalledOnce()
    const changed = vi.fn()
    reopened.on('state-changed', changed)
    pending.resolve('1')
    expect(await initializing).toMatchObject({ error: { code: 'SHUTDOWN' } })
    expect(changed).not.toHaveBeenCalled()
    expect(reopened.getIdentitySnapshot()).toBeNull()
  } finally {
    pending.resolve('1')
    await initializing
    await stopping
    await s.engine.shutdown()
    await reopened?.shutdown()
  }
}, 20_000)
