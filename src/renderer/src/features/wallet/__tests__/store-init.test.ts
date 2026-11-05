// @vitest-environment happy-dom
import { randomUUID, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletSnapshot, WalletTransaction } from '@shared/types'

const mocks = vi.hoisted(() => ({
  listener: null as ((snapshot: WalletSnapshot) => void) | null,
  getSnapshot: vi.fn(),
  getSettings: vi.fn(),
  getHistory: vi.fn(),
  unlock: vi.fn(),
  send: vi.fn(),
  getBalance: vi.fn(),
}))

vi.mock('../client', () => ({
  walletClient: {
    ...mocks,
    isAvailable: () => false,
    onSnapshotChanged: (listener: (snapshot: WalletSnapshot) => void) => {
      mocks.listener = listener
      return () => {}
    },
  },
}))

import { useWalletStore } from '../store'

function snapshot(values: Partial<WalletSnapshot> = {}): WalletSnapshot {
  return {
    isCreated: false,
    address: '',
    addressRaw: '',
    publicKey: '',
    balance: '0',
    revision: 1,
    sessionRevision: 0,
    transactions: [],
    ...values,
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID })
  sessionStorage.clear()
  mocks.getSnapshot.mockReset().mockResolvedValue(snapshot())
  mocks.getSettings.mockReset().mockResolvedValue({ notificationStyle: 'popup' })
  mocks.getHistory.mockReset().mockResolvedValue([])
  mocks.unlock.mockReset().mockResolvedValue({ isLocked: false })
  mocks.send
    .mockReset()
    .mockImplementation(async (_to, _amount, _comment, _encrypted, id: string) => transaction({ id, operationId: id }))
  mocks.getBalance.mockReset().mockResolvedValue('100')
  useWalletStore.setState({
    ...snapshot(),
    snapshotRevision: -1,
    initialized: false,
    isLoading: false,
    isCreated: false,
    error: null,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

function transaction(values: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    id: 'pending',
    operationId: 'pending',
    type: 'send',
    amount: '1',
    address: 'recipient',
    timestamp: 1,
    status: 'pending',
    operationState: 'submitted',
    ...values,
  }
}

describe('wallet initialization', () => {
  it('can retry initialization after a failed snapshot request', async () => {
    mocks.getSnapshot.mockRejectedValueOnce(new Error('IPC unavailable'))
    await useWalletStore.getState().init()
    await useWalletStore.getState().init()
    expect(mocks.getSnapshot).toHaveBeenCalledTimes(2)
    expect(useWalletStore.getState()).toMatchObject({ initialized: true, isLoading: false, error: null })
  })

  it('can retry initialization after a failed settings request', async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error('Settings unavailable'))
    await useWalletStore.getState().init()
    await useWalletStore.getState().init()
    expect(mocks.getSettings).toHaveBeenCalledTimes(2)
    expect(useWalletStore.getState().initialized).toBe(true)
  })

  it('does not repeat successful initialization when no wallet exists', async () => {
    await useWalletStore.getState().init()
    await useWalletStore.getState().init()
    expect(mocks.getSnapshot).toHaveBeenCalledOnce()
    expect(useWalletStore.getState()).toMatchObject({ initialized: true, isCreated: false })
  })
})

it('applies complete revisions atomically and ignores obsolete events', () => {
  const operation: WalletTransaction = {
    id: 'operation',
    operationId: 'operation',
    type: 'x402',
    amount: '5',
    address: 'recipient',
    timestamp: 1,
    status: 'pending',
    x402Domain: 'shop.ton',
  }
  mocks.listener!(snapshot({ revision: 5, balance: '10', transactions: [operation] }))
  mocks.listener!(snapshot({ revision: 4, balance: '0' }))
  expect(useWalletStore.getState()).toMatchObject({ snapshotRevision: 5, balance: '10', transactions: [operation] })
  const resolved = { ...operation, operationState: 'included', execution: 'partial' as const, hash: 'chain-hash' }
  mocks.listener!(snapshot({ revision: 6, balance: '5', transactions: [resolved] }))
  expect(useWalletStore.getState()).toMatchObject({ snapshotRevision: 6, balance: '5', transactions: [resolved] })
})

it('ignores a late initial response after a newer lock notification', async () => {
  let finish!: (value: WalletSnapshot) => void
  mocks.getSnapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const loading = useWalletStore.getState().init()
  mocks.listener!(snapshot({ revision: 8, sessionRevision: 3, isLocked: true }))
  finish(snapshot({ revision: 7, sessionRevision: 2, isLocked: false }))
  await loading
  expect(useWalletStore.getState()).toMatchObject({ snapshotRevision: 8, sessionRevision: 3, isLocked: true })
})

it('does not replace newer history with the result of an older request', async () => {
  let finish!: (value: WalletTransaction[]) => void
  mocks.getHistory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const loading = useWalletStore.getState().loadHistory()
  const transaction: WalletTransaction = {
    id: 'new',
    type: 'receive',
    address: 'sender',
    amount: '1',
    timestamp: 1,
    status: 'confirmed',
  }
  mocks.listener!(snapshot({ revision: 8, transactions: [transaction] }))
  mocks.getSnapshot.mockResolvedValueOnce(snapshot({ revision: 7, transactions: [] }))
  finish([])
  await loading
  expect(useWalletStore.getState().transactions).toEqual([transaction])
})

it('does not apply an old unlock result after a newer lock snapshot', async () => {
  let finish!: (value: unknown) => void
  mocks.unlock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const opening = useWalletStore.getState().unlock('password')
  mocks.listener!(snapshot({ revision: 8, sessionRevision: 3, isLocked: true }))
  mocks.getSnapshot.mockResolvedValueOnce(snapshot({ revision: 7, sessionRevision: 2, isLocked: false }))
  finish({ isLocked: false })
  await opening
  expect(useWalletStore.getState()).toMatchObject({ snapshotRevision: 8, sessionRevision: 3, isLocked: true })
})

it('starts a new identical payment once the previous operation is confirmed', async () => {
  await useWalletStore.getState().send('recipient', '1', undefined, false)
  const original = mocks.send.mock.calls[0][4] as string
  mocks.listener!(
    snapshot({
      revision: 2,
      transactions: [
        transaction({
          id: original,
          operationId: original,
          status: 'confirmed',
          operationState: 'included',
          execution: 'succeeded',
        }),
      ],
    })
  )
  await useWalletStore.getState().send('recipient', '1', undefined, false)
  expect(mocks.send.mock.calls[1][4]).not.toBe(original)
})

it.each(['expired', 'included'] as const)('rejects a send whose operation %s failed', async (phase) => {
  mocks.send.mockResolvedValue(
    transaction({ status: 'failed', operationState: phase, execution: phase === 'included' ? 'failed' : undefined })
  )
  await expect(useWalletStore.getState().send('recipient', '1', undefined, false)).rejects.toThrow()
  expect(useWalletStore.getState().error).toBeTruthy()
  expect(useWalletStore.getState().isSending).toBe(false)
})

it.each(['unknown', 'seqno-consumed', 'included'] as const)(
  'keeps the same id while the previous operation %s is uncertain',
  async (phase) => {
    await useWalletStore.getState().send('recipient', '1', undefined, false)
    const original = mocks.send.mock.calls[0][4] as string
    mocks.listener!(
      snapshot({
        revision: 3,
        transactions: [
          transaction({
            id: original,
            operationId: original,
            operationState: phase,
            execution: phase === 'included' ? 'partial' : 'unknown',
          }),
        ],
      })
    )
    // An obsolete confirmation cannot free the current retry identifier.
    mocks.listener!(
      snapshot({
        revision: 2,
        transactions: [transaction({ id: original, operationId: original, status: 'confirmed' })],
      })
    )
    await useWalletStore.getState().send('recipient', '1', undefined, false)
    expect(mocks.send.mock.calls[1][4]).toBe(original)
  }
)

it('does not create a new payment when confirmation arrives during an existing retry', async () => {
  await useWalletStore.getState().send('recipient', '1', undefined, false)
  const original = mocks.send.mock.calls[0][4] as string
  let finish!: (value: ArrayBuffer) => void
  const digest = new Promise<ArrayBuffer>((resolve) => {
    finish = resolve
  })
  vi.stubGlobal('crypto', { subtle: { digest: () => digest }, randomUUID })
  mocks.send.mockResolvedValueOnce(
    transaction({
      id: original,
      operationId: original,
      status: 'confirmed',
      operationState: 'included',
      execution: 'succeeded',
    })
  )
  const retry = useWalletStore.getState().send('recipient', '1', undefined, false)
  mocks.listener!(
    snapshot({ revision: 2, transactions: [transaction({ id: original, operationId: original, status: 'confirmed' })] })
  )
  finish(
    await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(['recipient', '1', undefined, false]))
    )
  )
  await retry
  expect(mocks.send.mock.calls[1][4]).toBe(original)
})

it('does not turn a confirmed send into a storage cleanup error', async () => {
  mocks.send.mockResolvedValue(transaction({ status: 'confirmed', operationState: 'included', execution: 'succeeded' }))
  const values = new Map<string, string>()
  const remove = vi.fn(() => {
    throw new Error('storage denied')
  })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: remove,
  })
  await expect(useWalletStore.getState().send('recipient', '1', undefined, false)).resolves.toBeUndefined()
  expect(remove).toHaveBeenCalledOnce()
})

it.each(['pending', 'confirmed'] as const)(
  'releases Sending after a %s send result without waiting for network or cached snapshot refreshes',
  async (status) => {
    let finishSnapshot!: (value: WalletSnapshot) => void
    mocks.getSnapshot.mockImplementation(() => new Promise((resolve) => (finishSnapshot = resolve)))
    mocks.getBalance.mockImplementation(() => new Promise(() => {}))
    mocks.getHistory.mockImplementation(() => new Promise(() => {}))
    mocks.send.mockResolvedValue(
      transaction({
        status,
        operationState: status === 'pending' ? 'submitted' : 'included',
        execution: status === 'pending' ? undefined : 'succeeded',
      })
    )

    await useWalletStore.getState().send('recipient', '1', undefined, false)

    expect(useWalletStore.getState()).toMatchObject({ isSending: false, error: null })
    expect(mocks.getBalance).not.toHaveBeenCalled()
    expect(mocks.getHistory).not.toHaveBeenCalled()
    expect(mocks.getSnapshot).toHaveBeenCalledOnce()
    finishSnapshot(snapshot({ revision: 10, balance: '90' }))
    await Promise.resolve()
    expect(useWalletStore.getState().balance).toBe('90')
  }
)

it('preserves a confirmed send when refreshing the cached snapshot fails', async () => {
  mocks.send.mockResolvedValue(transaction({ status: 'confirmed', operationState: 'included', execution: 'succeeded' }))
  mocks.getSnapshot.mockRejectedValue(new Error('snapshot unavailable'))
  await expect(useWalletStore.getState().send('recipient', '1', undefined, false)).resolves.toBeUndefined()
  expect(useWalletStore.getState()).toMatchObject({ isSending: false, error: null })
})
