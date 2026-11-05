import { describe, expect, it, vi } from 'vitest'
import {
  Address,
  beginCell,
  Cell,
  loadMessage,
  loadOutList,
  storeTransaction,
  storeMessage,
  Dictionary,
  type Message,
  type Transaction,
} from '@ton/core'
import { keyPairFromSeed, signVerify } from '@ton/crypto'
import { createWalletContract } from '../wallet-versions'
import { createEncryptedCommentBody } from '../encrypted-comment'
import { OperationJournal, isOperationPending } from '../journal'
import { WalletTransfers, normalizedExternalHash, type TransferIntent } from '../transactions'
import type { JournalStore } from '../ports'
import type { WalletBridgePort } from '../bridge-port'
import type { WalletChainSnapshot } from '../network-types'

function setup(version: 'v3R1' | 'v3R2' | 'v4R2' | 'v5R1' = 'v5R1') {
  const pair = keyPairFromSeed(Buffer.alloc(32, 7))
  const contract = createWalletContract(version, pair.publicKey)
  const identity = {
    publicKey: pair.publicKey.toString('hex'),
    addressRaw: contract.address.toRawString(),
    revision: 1,
  }
  let epoch = 0
  const controller = new AbortController()
  const data = new Map<string, Buffer>()
  const store: JournalStore = {
    read: async (account) => data.get(account) ?? null,
    compareExchange: vi.fn(async (account, revision, value) => {
      const before = data.get(account)
      if ((before ? JSON.parse(before.toString()).revision : 0) !== revision) throw new Error('Conflict')
      data.set(account, Buffer.from(value))
    }),
  }
  const account = `mainnet:${identity.addressRaw}`
  const journal = new OperationJournal(store)
  const snapshot: WalletChainSnapshot = {
    address: contract.address.toString(),
    balance: '100000000000',
    status: 'uninit',
    seqno: 0,
    last_tx_lt: '0',
    last_tx_hash: '',
    block_time: 1000,
    block: {
      workchain: 0,
      shard: '8000000000000000',
      seqno: 1,
      root_hash: '00'.repeat(32),
      file_hash: '00'.repeat(32),
    },
    masterchain: {
      workchain: -1,
      shard: '8000000000000000',
      seqno: 2,
      root_hash: '00'.repeat(32),
      file_hash: '00'.repeat(32),
    },
  }
  const provider = {
    getWalletSnapshot: vi.fn(async () => structuredClone(snapshot)),
    getAccountInformation: vi.fn(async () => ({ balance: '100000000000', status: 'active' as const })),
    emulateTransaction: vi.fn(async () => ({ accepted: true, success: true, exit_code: 0, total_fees: '100' })),
    broadcast: vi.fn(async () => {}),
    sendAndWatch: vi.fn(async () => 'confirmed-hint'),
    getRawTransactions: vi.fn(async () => []),
  } as unknown as WalletBridgePort
  const changed = vi.fn()
  const transfers = new WalletTransfers(
    {
      identity: () => identity,
      contract: () => contract,
      session: () => epoch,
      signal: () => controller.signal,
      assertReady: () => {
        if (epoch) throw new Error('Locked')
      },
      provider: () => provider,
      withSecret: async (fn) => fn(pair.secretKey),
      changed,
    },
    journal
  )
  const intent: TransferIntent = {
    operationId: 'payment-1',
    messages: [{ address: Address.parseRaw('0:' + '22'.repeat(32)).toString(), amount: '1234' }],
  }
  return {
    pair,
    contract,
    identity,
    data,
    store,
    account,
    journal,
    snapshot,
    provider,
    transfers,
    changed,
    intent,
    lock: () => {
      epoch++
      controller.abort()
      journal.lock()
    },
  }
}

describe('durable wallet transfers without Electron', () => {
  it.each(['snapshot', 'emulation'] as const)(
    'reports a %s failure as preflight failure before authorization',
    async (stage) => {
      const s = setup()
      await s.journal.open(s.pair.secretKey, s.account)
      const cause = new Error('lite server error, code 651: cannot load block')
      if (stage === 'snapshot') vi.mocked(s.provider.getWalletSnapshot).mockRejectedValue(cause)
      else vi.mocked(s.provider.emulateTransaction).mockRejectedValue(cause)
      const authorize = vi.fn(async () => true)
      await expect(s.transfers.sendTransfer(s.intent, authorize)).rejects.toMatchObject({
        code: 'TRANSFER_PREFLIGHT_FAILED',
        retryable: true,
        cause,
      })
      expect(authorize).not.toHaveBeenCalled()
      expect(s.provider.sendAndWatch).not.toHaveBeenCalled()
      expect(s.journal.list()).toEqual([])
    }
  )
  it.each(['v3R1', 'v3R2', 'v4R2', 'v5R1'] as const)(
    'persists a real %s signed message before broadcast',
    async (version) => {
      const s = setup(version)
      await s.journal.open(s.pair.secretKey, s.account)
      vi.mocked(s.provider.sendAndWatch).mockImplementation(async (bytes) => {
        const persisted = new OperationJournal(s.store)
        await persisted.open(s.pair.secretKey, s.account)
        expect(persisted.get(s.intent.operationId)?.phase).toBe('submitting')
        expect(persisted.get(s.intent.operationId)?.boc).toBe(bytes.toString('base64'))
        persisted.lock()
        return 'confirmation-hint'
      })
      const op = await s.transfers.sendTransfer(s.intent, async () => true)
      expect(op.phase).toBe('submitted')
      expect(op.validUntil).toBe(1300)
      expect(op.normalizedHash).toBe(normalizedExternalHash(op.boc!))
      const body = loadMessage(Cell.fromBase64(op.boc!).beginParse()).body
      const slice = body.beginParse()
      if (version === 'v5R1') {
        const signing = beginCell().storeBits(slice.loadBits(body.bits.length - 512))
        for (const ref of body.refs) signing.storeRef(ref)
        expect(signVerify(signing.endCell().hash(), slice.loadBuffer(64), s.pair.publicKey)).toBe(true)
      } else {
        const signature = slice.loadBuffer(64)
        expect(signVerify(beginCell().storeSlice(slice).endCell().hash(), signature, s.pair.publicKey)).toBe(true)
      }
      expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
      expect(s.data.get(s.account)!.toString()).not.toContain(op.boc!)
    }
  )
  it('coalesces concurrent identical requests and rejects changed contents', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const [first, second] = await Promise.all([
      s.transfers.sendTransfer(s.intent, async () => true),
      s.transfers.sendTransfer(s.intent, async () => true),
    ])
    expect(first.boc).toBe(second.boc)
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
    await expect(
      s.transfers.sendTransfer({ ...s.intent, messages: [{ ...s.intent.messages[0], amount: '1235' }] })
    ).rejects.toThrow('content changed')
    await s.transfers.sendTransfer(s.intent)
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
  })
  it('never exposes bytes when durable persistence fails', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    vi.mocked(s.store.compareExchange).mockRejectedValue(new Error('Disk full'))
    await expect(s.transfers.signForRelay(s.intent, async () => true)).rejects.toThrow('Disk full')
    expect(s.provider.sendAndWatch).not.toHaveBeenCalled()
  })
  it('rejects a confirmation after lock even with the same wallet address', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    await expect(
      s.transfers.sendTransfer(s.intent, async () => {
        s.lock()
        return true
      })
    ).rejects.toThrow('Wallet session changed')
    expect(s.provider.sendAndWatch).not.toHaveBeenCalled()
    expect(s.data.size).toBe(0)
  })
  it('retains an uncertain submitted BOC and resumes read-only after restart', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    vi.mocked(s.provider.sendAndWatch).mockRejectedValue(new Error('Connection lost'))
    const op = await s.transfers.sendTransfer(s.intent, async () => true)
    expect(op.phase).toBe('unknown')
    s.journal.lock()
    await s.journal.open(s.pair.secretKey, s.account)
    await s.transfers.resolvePending()
    expect(s.journal.get(op.id)?.boc).toBe(op.boc)
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
    await expect(s.transfers.sendTransfer({ ...s.intent, operationId: 'second' }, async () => true)).rejects.toThrow(
      'unresolved'
    )
  })
  it('uses shard time to resolve expiry, not device time', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const op = await s.transfers.signForRelay(s.intent, async () => true)
    vi.spyOn(Date, 'now').mockReturnValue(9999999999999)
    await s.transfers.resolvePending()
    expect(s.journal.get(op.id)?.phase).toBe('handed-off')
    s.snapshot.block_time = op.validUntil + 61
    await s.transfers.resolvePending()
    expect(s.journal.get(op.id)?.phase).toBe('expired')
    expect(isOperationPending(s.journal.get(op.id)!)).toBe(false)
    vi.restoreAllMocks()
  })
  it('does not release an operation when archive history is unavailable', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const op = await s.transfers.sendTransfer(s.intent, async () => true)
    s.snapshot.last_tx_lt = '100'
    s.snapshot.last_tx_hash = '11'.repeat(32)
    s.snapshot.block_time = op.validUntil + 61
    await s.transfers.resolvePending()
    expect(s.journal.get(op.id)?.phase).toBe('submitted')
  })
  it('authenticates the journal and fails closed for wrong keys and tampering', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    await s.transfers.signForRelay(s.intent, async () => true)
    s.journal.lock()
    await expect(s.journal.open(Buffer.alloc(64, 9), s.account)).rejects.toThrow('protected operation journal')
    const raw = JSON.parse(s.data.get(s.account)!.toString())
    raw.revision++
    s.data.set(s.account, Buffer.from(JSON.stringify(raw)))
    await expect(s.journal.open(s.pair.secretKey, s.account)).rejects.toThrow('protected operation journal')
  })
  it('preserves an exact caller expiration and never resigns an expired operation', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const op = await s.transfers.sendTransfer({ ...s.intent, validUntil: 1100 }, async () => true)
    expect(op.validUntil).toBe(1100)
    s.snapshot.block_time = 1200
    await s.transfers.resolvePending()
    const same = await s.transfers.sendTransfer({ ...s.intent, validUntil: 1100 }, async () => true)
    expect(same.boc).toBe(op.boc)
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
  })
})

function transactionRecord(
  s: ReturnType<typeof setup>,
  operation: Awaited<ReturnType<WalletTransfers['sendTransfer']>>,
  execution: 'success' | 'failed' | 'partial' | 'no-actions' | 'missing-output'
) {
  const source: Transaction = {
    address: BigInt('0x' + s.contract.address.hash.toString('hex')),
    lt: 100n,
    prevTransactionHash: 0n,
    prevTransactionLt: 0n,
    now: 1002,
    outMessagesCount: 0,
    oldStatus: s.snapshot.status === 'uninit' ? 'uninitialized' : 'active',
    endStatus: 'active',
    inMessage: loadMessage(Cell.fromBase64(operation.boc!).beginParse()),
    outMessages: Dictionary.empty<number, Message>(Dictionary.Keys.Uint(15), {
      serialize: (message, builder) => builder.storeRef(beginCell().store(storeMessage(message)).endCell()),
      parse: (slice) => loadMessage(slice.loadRef().beginParse()),
    }),
    totalFees: { coins: 100n },
    stateUpdate: { oldHash: Buffer.alloc(32), newHash: Buffer.alloc(32) },
    description: {
      type: 'generic',
      creditFirst: false,
      aborted: execution === 'failed',
      destroyed: false,
      computePhase: {
        type: 'vm',
        success: execution !== 'failed',
        messageStateUsed: false,
        accountActivated: s.snapshot.status === 'uninit',
        gasFees: 1n,
        gasUsed: 1n,
        gasLimit: 1n,
        mode: 0,
        exitCode: execution === 'failed' ? 32 : 0,
        vmSteps: 1,
        vmInitStateHash: 0n,
        vmFinalStateHash: 0n,
      },
      actionPhase:
        execution === 'no-actions'
          ? undefined
          : {
              success: true,
              valid: true,
              noFunds: false,
              statusChange: 'unchanged',
              resultCode: 0,
              totalActions: 1,
              specActions: 0,
              skippedActions: execution === 'partial' ? 1 : 0,
              messagesCreated: execution === 'success' ? 1 : 0,
              actionListHash: 0n,
              totalMessageSize: { cells: 0n, bits: 0n },
            },
    },
    raw: beginCell().endCell(),
    hash: () => Buffer.alloc(32),
  }
  if (execution === 'success') {
    operation.messages.forEach((message, index) => {
      source.outMessages.set(index, {
        info: {
          type: 'internal',
          ihrDisabled: true,
          bounce: message.bounce ?? false,
          bounced: false,
          src: s.contract.address,
          dest: Address.parse(message.address),
          value: { coins: BigInt(message.amount) },
          ihrFee: 0n,
          forwardFee: 0n,
          createdLt: 100n,
          createdAt: 1002,
        },
        body: message.payload ? Cell.fromBase64(message.payload) : beginCell().endCell(),
      })
    })
    source.outMessagesCount = source.outMessages.size
  }
  const raw = beginCell().store(storeTransaction(source)).endCell()
  const record = { hash: raw.hash().toString('hex'), lt: '100', now: 1002, boc: raw.toBoc().toString('base64') }
  s.snapshot.last_tx_lt = record.lt
  s.snapshot.last_tx_hash = record.hash
  s.snapshot.seqno = 1
  vi.mocked(s.provider.getRawTransactions).mockResolvedValue([record])
  return record
}

describe('chain evidence and replay boundaries', () => {
  function includeFirstTransfer(
    s: ReturnType<typeof setup>,
    operation: NonNullable<ReturnType<OperationJournal['get']>>
  ) {
    const record = transactionRecord(s, operation, 'success')
    const data = s.contract.init.data!.beginParse()
    s.snapshot.status = 'active'
    s.snapshot.code_hash = s.contract.init.code!.hash().toString('hex')
    s.snapshot.data_boc = beginCell()
      .storeBit(data.loadBit())
      .storeUint(1, 32)
      .storeSlice(data.skip(32))
      .endCell()
      .toBoc()
      .toString('base64')
    return record.hash
  }

  it('uses the main submission path and confirms an encrypted first transfer immediately from transaction evidence', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    s.intent.messages[0].payload = (
      await createEncryptedCommentBody({
        senderAddress: s.contract.address,
        senderSecretKey: s.pair.secretKey,
        recipientPublicKey: keyPairFromSeed(Buffer.alloc(32, 8)).publicKey,
        comment: 'encrypted first transfer',
      })
    )
      .toBoc()
      .toString('base64')
    vi.mocked(s.provider.sendAndWatch).mockImplementation(async (bytes) => {
      const saved = s.journal.get(s.intent.operationId)!
      expect(saved.phase).toBe('submitting')
      expect(saved.boc).toBe(bytes.toString('base64'))
      const external = loadMessage(Cell.fromBase64(saved.boc!).beginParse())
      expect(external.init).not.toBeNull()
      const signed = external.body.beginParse()
      const signing = beginCell().storeBits(signed.loadBits(external.body.bits.length - 512))
      for (const ref of external.body.refs) signing.storeRef(ref)
      expect(signVerify(signing.endCell().hash(), signed.loadBuffer(64), s.pair.publicKey)).toBe(true)
      return includeFirstTransfer(s, saved)
    })
    const result = await s.transfers.sendTransfer(s.intent, async () => true)
    expect(result).toMatchObject({ phase: 'included', execution: 'succeeded', closed: true })
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
    expect(s.provider.broadcast).not.toHaveBeenCalled()
  })

  it('resolves an explicit retry of the same signed message without waiting for a recovery timer', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const first = await s.transfers.sendTransfer(s.intent, async () => true)
    expect(first.phase).toBe('submitted')
    vi.mocked(s.provider.sendAndWatch).mockImplementation(async () => includeFirstTransfer(s, first))
    const result = await s.transfers.retryOperation(first.id, async () => true)
    expect(result).toMatchObject({ phase: 'included', execution: 'succeeded', boc: first.boc, closed: true })
    expect(vi.mocked(s.provider.sendAndWatch).mock.calls.map(([bytes]) => bytes.toString('base64'))).toEqual([
      first.boc,
      first.boc,
    ])
    expect(s.provider.broadcast).not.toHaveBeenCalled()
  })

  it('starts a fresh proof read after a pre-confirmation resolution finishes', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    let releaseEarlier!: () => void
    vi.mocked(s.provider.sendAndWatch).mockImplementation(async () => {
      const before = structuredClone(s.snapshot)
      vi.mocked(s.provider.getWalletSnapshot).mockImplementationOnce(
        () => new Promise((resolve) => (releaseEarlier = () => resolve(before)))
      )
      void s.transfers.resolvePending().catch(() => undefined)
      return includeFirstTransfer(s, s.journal.get(s.intent.operationId)!)
    })
    const sending = s.transfers.sendTransfer(s.intent, async () => true)
    await vi.waitFor(() => expect(releaseEarlier).toBeTypeOf('function'))
    releaseEarlier()
    await expect(sending).resolves.toMatchObject({ phase: 'included', execution: 'succeeded', closed: true })
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
  })

  it('does not publish a late watch result after lock or fall back to a second broadcast', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    let complete!: (hash: string) => void
    vi.mocked(s.provider.sendAndWatch).mockImplementation(() => new Promise((resolve) => (complete = resolve)))
    const sending = s.transfers.sendTransfer(s.intent, async () => true)
    await vi.waitFor(() => expect(s.provider.sendAndWatch).toHaveBeenCalledOnce())
    const rejected = expect(sending).rejects.toThrow('Locked')
    s.lock()
    await rejected
    const published = s.changed.mock.calls.length
    complete('late-confirmation')
    await Promise.resolve()
    expect(s.changed).toHaveBeenCalledTimes(published)
    expect(s.provider.broadcast).not.toHaveBeenCalled()
    const reopened = new OperationJournal(s.store)
    await reopened.open(s.pair.secretKey, s.account)
    expect(reopened.get(s.intent.operationId)?.phase).toBe('submitting')
    reopened.lock()
  })

  it('emulates the complete ordered batch with the exact approved expiration', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const messages = [s.intent.messages[0], { ...s.intent.messages[0], amount: '999' }]
    await s.transfers.sendTransfer({ ...s.intent, messages, validUntil: 1100 }, async () => true)
    const emulations = vi.mocked(s.provider.emulateTransaction).mock.calls
    expect(emulations).toHaveLength(2)
    for (const [, boc] of emulations) {
      const body = loadMessage(Cell.fromBase64(boc).beginParse()).body.beginParse()
      body.skip(64)
      expect(body.loadUint(32)).toBe(1100)
      body.skip(32)
      const actions = loadOutList(body.loadMaybeRef()!.beginParse())
      expect(
        actions.map((action) =>
          action.type === 'sendMsg' && action.outMsg.info.type === 'internal'
            ? action.outMsg.info.value.coins.toString()
            : null
        )
      ).toEqual(['1234', '999'])
    }
  })

  it('reconfirms every increased fee and pins the original approval window', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const fees = ['100', '200', '300', '300']
    vi.mocked(s.provider.emulateTransaction).mockImplementation(async () => ({
      accepted: true,
      success: true,
      exit_code: 0,
      total_fees: fees.shift()!,
    }))
    const approved: string[] = []
    const operation = await s.transfers.sendTransfer(s.intent, async (review) => {
      approved.push(review.estimatedFee)
      expect(review.validUntil).toBe(1300)
      s.snapshot.block_time += 1
      return true
    })
    expect(approved).toEqual(['105', '210', '315'])
    expect(operation.validUntil).toBe(1300)
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
  })

  it.each([
    ['success', 'succeeded'],
    ['failed', 'failed'],
    ['partial', 'partial'],
    ['no-actions', 'unknown'],
    ['missing-output', 'partial'],
  ] as const)('separates inclusion from %s execution', async (execution, expected) => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const operation = await s.transfers.sendTransfer(s.intent, async () => true)
    transactionRecord(s, operation, execution)
    await s.transfers.resolvePending()
    const result = s.journal.get(operation.id)!
    expect(result.phase).toBe('included')
    expect(result.execution).toBe(expected)
    expect(result.closed).toBe(true)
    const again = await s.transfers.sendTransfer(s.intent)
    expect(again.transactionHash).toBe(result.transactionHash)
    expect(s.provider.sendAndWatch).toHaveBeenCalledOnce()
  })
  it('retries the identical signed bytes after explicit authorization', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const operation = await s.transfers.sendTransfer(s.intent, async () => true)
    await s.transfers.retryOperation(operation.id, async (review) => {
      expect(review.messages).toHaveLength(1)
      return true
    })
    expect(vi.mocked(s.provider.sendAndWatch).mock.calls.map(([bytes]) => bytes.toString('base64'))).toEqual([
      operation.boc,
      operation.boc,
    ])
  })
  it('does not overwrite a terminal result with a late submission callback', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const operation = await s.transfers.sendTransfer(s.intent, async () => true)
    await s.journal.save({ ...operation, phase: 'expired', closed: true })
    await s.journal.save({ ...operation, phase: 'unknown' })
    expect(s.journal.get(operation.id)?.phase).toBe('expired')
  })
  it('never treats lost events or a moving account head as proof of expiry', async () => {
    const s = setup()
    await s.journal.open(s.pair.secretKey, s.account)
    const operation = await s.transfers.sendTransfer(s.intent, async () => true)
    s.snapshot.block_time = operation.validUntil + 61
    let reads = 0
    vi.mocked(s.provider.getWalletSnapshot).mockImplementation(async () => {
      const value = structuredClone(s.snapshot)
      if (++reads === 2) value.last_tx_lt = '1'
      return value
    })
    await s.transfers.resolvePending()
    expect(s.journal.get(operation.id)?.phase).toBe('submitted')
  })
})

it('aborts an unresolved host confirmation as soon as the wallet is locked', async () => {
  const s = setup()
  await s.journal.open(s.pair.secretKey, s.account)
  const authorize = vi.fn(() => new Promise<boolean>(() => {}))
  const operation = s.transfers.sendTransfer(s.intent, authorize)
  const rejected = expect(operation).rejects.toThrow('Wallet session changed')
  await vi.waitFor(() => expect(authorize).toHaveBeenCalledOnce())
  s.lock()
  await rejected
  expect(s.data.size).toBe(0)
  expect(s.provider.sendAndWatch).not.toHaveBeenCalled()
})

it('observes a host failure even when that host invalidates the session first', async () => {
  const s = setup()
  await s.journal.open(s.pair.secretKey, s.account)
  await expect(
    s.transfers.sendTransfer(s.intent, async () => {
      s.lock()
      throw new Error('Host confirmation closed')
    })
  ).rejects.toThrow('Wallet session changed')
  expect(s.provider.sendAndWatch).not.toHaveBeenCalled()
})

it('does not broadcast when a publication callback locks the wallet', async () => {
  const s = setup()
  await s.journal.open(s.pair.secretKey, s.account)
  s.changed.mockImplementationOnce(() => s.lock())
  await expect(s.transfers.sendTransfer(s.intent, async () => true)).rejects.toThrow('Locked')
  expect(s.provider.sendAndWatch).not.toHaveBeenCalled()
  await s.journal.open(s.pair.secretKey, s.account)
  expect(s.journal.get(s.intent.operationId)?.phase).toBe('submitting')
})
