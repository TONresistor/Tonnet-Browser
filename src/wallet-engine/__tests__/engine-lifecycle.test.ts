import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mnemonicNew, keyPairFromSeed } from '@ton/crypto'
import { Address, Cell, loadOutList, loadMessage } from '@ton/core'
import { WalletContractV5R1 } from '@ton/ton'
import { createEncryptedCommentBody } from '../encrypted-comment'
import type { WalletBridgePort } from '../bridge-port'
import { WalletEngine, type WalletEngineOptions } from '../engine'
import { deriveWalletAccount } from '../wallet-versions'
import { WalletHistoryManager } from '../history'
import { createLogger } from '../logger'
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
      emulation_context: 'test-context',
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
    emulateTransaction: vi.fn(async () => ({
      accepted: true,
      success: true,
      exit_code: 0,
      total_fees: '100',
      wallet_snapshot: await provider.getWalletSnapshot(engine.getState().address),
    })),
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

it('rebuilds edited reviews and signs the exact prepared encrypted comment', async () => {
  const event = vi.fn()
  const s = await fixture(true, { logger: { ...createLogger('test'), event } })
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const challenge = await s.engine.createBackupChallenge('correct horse battery staple')
    await s.engine.verifyBackup(
      challenge.challengeId,
      'correct horse battery staple',
      challenge.indexes.map((index) => created.mnemonic[index])
    )
    const recipient = Address.parseRaw('0:' + '22'.repeat(32)).toString()
    s.engine.on('operation-changed', (operation: { id: string; phase: string }) => {
      expect(s.engine.snapshot().operations.find((item) => item.id === operation.id)?.phase).toBe(operation.phase)
    })
    await expect(
      s.engine.signTonConnectTransaction([{ address: recipient, amount: '10' }], created.addressRaw, 'no-authorization')
    ).rejects.toThrow('authorization is required')
    const reviews: Array<{ comment?: string; commentEncrypted: boolean }> = []
    const result = await s.engine.sendNative(
      { to: recipient, amount: '10', operationId: 'native-review' },
      async (review) => {
        reviews.push({ comment: review.comment, commentEncrypted: review.commentEncrypted })
        if (reviews.length === 1) return { action: 'set-memo', comment: 'Thanks' }
        if (reviews.length === 2) return { action: 'set-encryption', encrypted: true }
        return { action: 'approve' }
      }
    )
    expect(reviews).toEqual([
      { comment: undefined, commentEncrypted: false },
      { comment: 'Thanks', commentEncrypted: false },
      { comment: 'Thanks', commentEncrypted: true },
    ])
    const operation = s.engine.getOperation('native-review')!
    expect(Cell.fromBase64(operation.messages[0].payload!).beginParse().loadUint(32)).toBe(0x2167da4b)
    const finalEmulation = vi.mocked(s.provider.emulateTransaction).mock.calls.at(-1)![1]
    const outgoingBody = (boc: string) => {
      const signed = loadMessage(Cell.fromBase64(boc).beginParse()).body.beginParse()
      signed.skip(128)
      const action = loadOutList(signed.loadMaybeRef()!.beginParse())[0]
      if (action.type !== 'sendMsg') throw new Error('Expected send action')
      return action.outMsg.body
    }
    expect(outgoingBody(finalEmulation).equals(outgoingBody(operation.boc!))).toBe(true)
    expect(outgoingBody(operation.boc!).equals(Cell.fromBase64(operation.messages[0].payload!))).toBe(true)
    expect(result).toMatchObject({ comment: 'Thanks', commentEncrypted: true, status: 'pending' })
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
    const timings = event.mock.calls.filter(([, name]) => name === 'wallet.transfer.timing')
    const mainPhases = new Set(['preparation', 'revalidation', 'reconciliation', 'send-total'])
    expect(timings.map(([, , , fields]) => fields.phase).filter((phase) => mainPhases.has(phase))).toEqual([
      'preparation',
      'preparation',
      'preparation',
      'revalidation',
      'reconciliation',
      'send-total',
    ])
    expect(timings.filter(([, , , fields]) => fields.phase === 'preparation-state-read')).toHaveLength(3)
    expect(timings.filter(([, , , fields]) => fields.phase === 'preparation-encrypted-comment')).toHaveLength(1)
    for (const [, , , fields] of timings) {
      expect(Object.keys(fields).sort()).toEqual(
        fields.phase === 'reconciliation' ? ['durationMs', 'phase', 'source'] : ['durationMs', 'phase']
      )
      expect(fields.durationMs).toBeGreaterThanOrEqual(0)
      if (fields.phase === 'reconciliation') expect(fields.source).toBe('fallback')
    }
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it.each([false, true])(
  'ends native Sending only after an accepted durable broadcast (failure: %s)',
  async (fail) => {
    const s = await fixture(true)
    try {
      const created = await s.engine.create({ password: 'correct horse battery staple' })
      const challenge = await s.engine.createBackupChallenge('correct horse battery staple')
      await s.engine.verifyBackup(
        challenge.challengeId,
        'correct horse battery staple',
        challenge.indexes.map((index) => created.mnemonic[index])
      )
      vi.mocked(s.provider.sendAndWatch).mockImplementation(async (bytes, acknowledge) => {
        if (fail) throw new Error('Connection lost before acknowledgement')
        await acknowledge?.(Cell.fromBoc(bytes)[0].hash().toString('hex'))
        return new Promise(() => {})
      })
      const input = { to: Address.parseRaw(`0:${'22'.repeat(32)}`).toString(), amount: '10', operationId: 'native-ack' }
      if (fail) {
        await expect(s.engine.sendNative(input, async () => ({ action: 'approve' }))).rejects.toMatchObject({
          code: 'TRANSACTION_PENDING',
        })
        await expect(s.engine.sendNative(input, async () => ({ action: 'approve' }))).rejects.toMatchObject({
          code: 'TRANSACTION_PENDING',
        })
        expect(s.engine.getOperation(input.operationId)?.phase).toBe('unknown')
      } else {
        await expect(s.engine.sendNative(input, async () => ({ action: 'approve' }))).resolves.toMatchObject({
          status: 'pending',
          operationState: 'submitted',
        })
        expect(s.engine.getOperation(input.operationId)?.boc).toBeTruthy()
      }
      expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
      created.mnemonic.fill('')
    } finally {
      await s.engine.shutdown()
    }
  },
  20_000
)

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

it('rejects a queued TON Connect signature after its request is revoked', async () => {
  const s = await fixture()
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const controller = new AbortController()
    const signing = s.engine.signData(
      'app.ton',
      { type: 'text', text: 'ownership' },
      created.addressRaw,
      s.engine.getSessionRevision(),
      controller.signal
    )
    controller.abort()
    await expect(signing).rejects.toMatchObject({ name: 'AbortError' })
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

it('publishes immutable revisions, observes changes without races, and releases waiters at shutdown', async () => {
  const s = await fixture(true)
  try {
    const first = s.engine.snapshot()
    expect(first.revision).toBe(0)
    const waiting = s.engine.waitForChange(first.revision)
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    expect((await waiting).revision).toBeGreaterThan(first.revision)
    const before = s.engine.snapshot()
    const after = await s.engine.waitForChange(first.revision)
    expect(after.revision).toBe(before.revision)
    expect(() => {
      ;(before.transactions as unknown[]).push({})
    }).toThrow()
    expect(first.isCreated).toBe(false)
    const balance = before.balance
    const changed = s.engine.waitForChange(before.revision)
    await s.engine.getBalance()
    expect((await changed).balance).toBe('100000000000')
    expect(before.balance).toBe(balance)
    const revision = s.engine.snapshot().revision
    await s.engine.getBalance()
    expect(s.engine.snapshot().revision).toBe(revision)
    const lock = s.engine.waitForChange(revision)
    s.engine.lock()
    expect((await lock).isLocked).toBe(true)
    expect(s.engine.snapshot().sessionRevision).toBeGreaterThan(before.sessionRevision)
    const pending = expect(s.engine.waitForChange(s.engine.snapshot().revision)).rejects.toThrow('shut down')
    await s.engine.shutdown()
    await pending
    expect(() => s.engine.snapshot()).toThrow('shut down')
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('decrypts incoming chain comments only in the current unlocked session without persisting plaintext', async () => {
  const s = await fixture(true)
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const sender = keyPairFromSeed(Buffer.alloc(32, 9))
    const senderAddress = WalletContractV5R1.create({ publicKey: sender.publicKey, workchain: 0 }).address
    const body = (
      await createEncryptedCommentBody({
        senderAddress,
        senderSecretKey: sender.secretKey,
        recipientPublicKey: Buffer.from(created.publicKey, 'hex'),
        comment: 'received privately',
      })
    )
      .toBoc()
      .toString('base64')
    const request = { sender: senderAddress.toRawString(), body }
    vi.mocked(s.provider.getTransactions).mockResolvedValue([
      {
        hash: 'incoming',
        lt: '1',
        now: 1000,
        in_msg: { source: request.sender, destination: created.addressRaw, value: '10', body },
      },
    ])
    const history = await s.engine.getHistory()
    expect(history[0]).toMatchObject({ commentEncrypted: true, encryptedComment: request })
    expect(history[0].comment).toBeUndefined()
    await expect(s.engine.decryptComment(request)).resolves.toBe('received privately')
    expect(JSON.stringify(s.engine.snapshot())).not.toContain('received privately')
    const interrupted = expect(s.engine.decryptComment(request)).rejects.toThrow('current wallet session')
    s.engine.lock()
    await interrupted
    await expect(s.engine.decryptComment(request)).rejects.toThrow('locked')
    await s.engine.unlock('correct horse battery staple')
    await expect(s.engine.decryptComment(request)).resolves.toBe('received privately')
    expect(JSON.stringify(s.engine.snapshot())).not.toContain('received privately')
    created.mnemonic.fill('')
    sender.secretKey.fill(0)
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('discards an older history response after the same phrase replaces the active wallet', async () => {
  const s = await fixture(true)
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    let finish!: (value: never[]) => void
    vi.mocked(s.provider.getTransactions).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const old = expect(s.engine.getHistory()).rejects.toThrow('superseded')
    await vi.waitFor(() => expect(s.provider.getTransactions).toHaveBeenCalledOnce())
    vi.spyOn(s.options.history, 'clear').mockRejectedValue(new Error('History storage unavailable'))
    await s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    finish([])
    await old
    expect(s.engine.snapshot().transactions).toEqual([])
    await expect(s.engine.getHistory()).rejects.toThrow('History storage unavailable')
    created.mnemonic.fill('')
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it('keeps the newest balance when older reads or observations finish late', async () => {
  const s = await fixture(true)
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    created.mnemonic.fill('')
    const older = deferred<string>()
    const newer = deferred<string>()
    vi.mocked(s.provider.getBalance).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const first = s.engine.getBalance()
    const second = s.engine.getBalance()
    newer.resolve('200')
    await second
    const revision = s.engine.snapshot().revision
    older.resolve('100')
    expect(await first).toBe('200')
    expect(s.engine.snapshot()).toMatchObject({ balance: '200', revision })

    const stale = deferred<string>()
    vi.mocked(s.provider.getBalance).mockReturnValueOnce(stale.promise)
    const reading = s.engine.getBalance()
    const observed = vi.mocked(s.provider.subscribeAccountState).mock.calls.at(-1)![1]
    // An observation with the same balance still supersedes an older poll.
    observed({
      address: created.address,
      balance: '200',
      status: 'active',
      last_tx_lt: '1',
      last_tx_hash: 'hash',
      block_seqno: 1,
    })
    stale.resolve('50')
    expect(await reading).toBe('200')
    expect(s.engine.snapshot()).toMatchObject({ balance: '200', revision })
  } finally {
    await s.engine.shutdown()
  }
}, 20_000)

it.each(['lock', 'shutdown'] as const)(
  'rechecks the current snapshot after a waiter wakes into %s',
  async (action) => {
    const s = await fixture(true)
    try {
      const created = await s.engine.create({ password: 'correct horse battery staple' })
      created.mnemonic.fill('')
      const waiting = s.engine.waitForChange(s.engine.snapshot().revision)
      const result = action === 'shutdown' ? expect(waiting).rejects.toThrow('shut down') : undefined
      s.engine.once('snapshot-changed', () => {
        if (action === 'lock') s.engine.lock()
        else s.engine.destroy()
      })
      await s.engine.getBalance()
      if (result) await result
      else {
        expect(await waiting).toBe(s.engine.snapshot())
        expect((await waiting).isLocked).toBe(true)
      }
    } finally {
      await s.engine.shutdown()
    }
  },
  20_000
)

it('keeps an engaged journal closed when locking interrupts the legacy read', async () => {
  const legacy = deferred<Record<string, { seqno: number; validUntil: number }>>()
  const readLegacy = vi.fn(async (): Promise<Record<string, { seqno: number; validUntil: number }>> => ({}))
  const s = await fixture(true, { legacyPending: readLegacy })
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    await s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    created.mnemonic.fill('')
    const operation = await s.engine.signForRelay(
      { operationId: 'engaged', messages: [{ address: '0:' + '22'.repeat(32), amount: '5' }] },
      async () => true
    )
    s.engine.lock()
    const earlierReads = readLegacy.mock.calls.length
    readLegacy.mockReturnValueOnce(legacy.promise)
    const opened = vi.fn()
    s.engine.on('journal-opened', opened)
    const rejected = expect(s.engine.unlock('correct horse battery staple')).rejects.toThrow('session changed')
    await vi.waitFor(() => expect(readLegacy).toHaveBeenCalledTimes(earlierReads + 1))
    expect(s.engine.getOperation(operation.id)?.phase).toBe('handed-off')
    s.engine.lock()
    legacy.resolve({})
    await rejected
    expect(opened).not.toHaveBeenCalled()
    expect(s.engine.snapshot().isLocked).toBe(true)
    await s.engine.unlock('correct horse battery staple')
    expect(opened).toHaveBeenCalledOnce()
    expect(opened.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: operation.id, boc: operation.boc, phase: 'handed-off' })])
    )
  } finally {
    legacy.resolve({})
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

it.each(['snapshot-changed', 'journal-opened'] as const)(
  'stops recovery when a %s observer locks during unlock',
  async (event) => {
    const s = await fixture()
    try {
      const created = await s.engine.create({ password: 'correct horse battery staple' })
      created.mnemonic.fill('')
      s.engine.lock()
      const opened = vi.fn(() => s.engine.getState().isLocked)
      s.engine.on('journal-opened', opened)
      const resolving = vi.spyOn(s.engine, 'resolvePending')
      s.engine.once(event, () => s.engine.lock())
      await expect(s.engine.unlock('correct horse battery staple')).rejects.toThrow('session changed')
      expect(s.engine.snapshot().isLocked).toBe(true)
      expect(opened.mock.results.map((result) => result.value)).toEqual(event === 'snapshot-changed' ? [] : [false])
      expect(resolving).not.toHaveBeenCalled()
    } finally {
      await s.engine.shutdown()
    }
  },
  20_000
)

it('does not start recovery when locking interrupts wallet activation', async () => {
  const s = await fixture()
  const clearing = deferred<void>()
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    const clear = vi.spyOn(s.options.history, 'clear').mockImplementationOnce(() => clearing.promise)
    const opened = vi.fn()
    s.engine.on('journal-opened', opened)
    const rejected = expect(
      s.engine.importWallet([...created.mnemonic], 'correct horse battery staple')
    ).rejects.toThrow('session changed')
    await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())
    s.engine.lock()
    clearing.resolve()
    await rejected
    expect(s.engine.snapshot().isLocked).toBe(true)
    expect(opened).not.toHaveBeenCalled()
    created.mnemonic.fill('')
  } finally {
    clearing.resolve()
    await s.engine.shutdown()
  }
}, 20_000)

it('invalidates an unfinished balance read when its bridge disconnects', async () => {
  let current: WalletBridgePort | null = null
  let changed: (bridge: WalletBridgePort | null) => void = () => {}
  const s = await fixture(true, {
    bridge: {
      getBridge: () => current,
      onBridgeChanged: (listener) => {
        changed = listener
        return () => {}
      },
    },
  })
  try {
    const created = await s.engine.create({ password: 'correct horse battery staple' })
    created.mnemonic.fill('')
    current = s.provider
    changed(current)
    await vi.waitFor(() => expect(s.engine.snapshot().balance).toBe('100000000000'))
    const pending = deferred<string>()
    vi.mocked(s.provider.getBalance).mockReturnValueOnce(pending.promise)
    const reading = s.engine.getBalance()
    current = null
    changed(null)
    pending.resolve('1')
    expect(await reading).toBe('100000000000')
    expect(s.engine.snapshot().balance).toBe('100000000000')
  } finally {
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

it.each(['commit', 'rollback'] as const)(
  'waits for an importing vault to %s before concurrent shutdown callers can reopen the profile',
  async (outcome) => {
    const s = await fixture()
    const writing = deferred<void>()
    const release = deferred<void>()
    const password = 'correct horse battery staple'
    let created: Awaited<ReturnType<WalletEngine['create']>> | undefined
    let replacement: string[] = []
    let importing: Promise<unknown> | undefined
    const stopping: Promise<void>[] = []
    const reopened = new WalletEngine(s.options)
    try {
      created = await s.engine.create({ password })
      replacement = await mnemonicNew(24)
      const write = s.options.vault.writeAtomic
      let writes = 0
      vi.spyOn(s.options.vault, 'writeAtomic').mockImplementation(async (...args) => {
        const current = ++writes
        if (current === (outcome === 'commit' ? 1 : 2)) {
          writing.resolve()
          await release.promise
        }
        await write(...args)
        if (outcome === 'rollback' && current === 1) throw new Error('Vault write failed')
      })
      importing = s.engine.importWallet([...replacement], password).then(
        (state) => ({ state }),
        (error: unknown) => ({ error })
      )
      await writing.promise
      const finished = vi.fn()
      stopping.push(s.engine.shutdown().then(finished), s.engine.shutdown().then(finished))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(finished).not.toHaveBeenCalled()
      expect(() => s.engine.snapshot()).toThrow('shut down')
      release.resolve()
      expect(await importing).toMatchObject({ error: expect.any(Error) })
      await Promise.all(stopping)
      expect(finished).toHaveBeenCalledTimes(2)
      expect(s.engine.getIdentitySnapshot()).toBeNull()
      await expect(s.engine.unlock(password)).rejects.toThrow('shut down')

      await reopened.init()
      await reopened.unlock(password)
      const exported = await reopened.exportMnemonic(password)
      try {
        expect(exported.mnemonic).toEqual(outcome === 'commit' ? replacement : created.mnemonic)
        const account = await deriveWalletAccount(exported.mnemonic, 'v5R1')
        expect(reopened.getState().addressRaw).toBe(account.addressRaw)
      } finally {
        exported.mnemonic.fill('')
      }
    } finally {
      release.resolve()
      await importing
      await Promise.all(stopping)
      await s.engine.shutdown()
      await reopened.shutdown()
      created?.mnemonic.fill('')
      replacement.fill('')
    }
  },
  20_000
)

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
