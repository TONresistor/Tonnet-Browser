import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletTransaction } from '../../../shared/types'

const { storageBackend, writes } = vi.hoisted(() => ({
  storageBackend: { data: null as unknown },
  writes: [] as unknown[],
}))

vi.mock('../../history/safe-storage-wrapper', () => ({
  SafeStorageWrapper: class {
    read = vi.fn(async () => storageBackend.data)
    write = vi.fn(async (data: unknown) => {
      writes.push(data)
      storageBackend.data = data
    })
    delete = vi.fn(async () => {
      storageBackend.data = null
    })
  },
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

import { WalletHistoryManager } from '../history'

function tx(p: Partial<WalletTransaction> = {}): WalletTransaction {
  return {
    id: 'id',
    type: 'send',
    amount: '1000',
    address: 'EQabc',
    timestamp: 1_000_000,
    status: 'confirmed',
    hash: 'HASH1',
    ...p,
  } as WalletTransaction
}

describe('WalletHistoryManager', () => {
  beforeEach(() => {
    storageBackend.data = null
    writes.length = 0
  })

  it('does not rewrite storage when reconcile produces the same history', async () => {
    const existing = [tx()]
    storageBackend.data = existing

    const manager = new WalletHistoryManager()
    const result = await manager.reconcile([{ ...existing[0] }])

    expect(result).toEqual(existing)
    expect(writes).toHaveLength(0)
  })

  it('writes storage when reconcile changes a transaction', async () => {
    storageBackend.data = [tx({ status: 'pending' })]

    const manager = new WalletHistoryManager()
    await manager.reconcile([tx({ status: 'confirmed' })])

    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual([tx({ status: 'confirmed' })])
  })

  it('does not rewrite storage when status is unchanged', async () => {
    storageBackend.data = [tx({ id: 'same-status', status: 'confirmed' })]

    const manager = new WalletHistoryManager()
    await manager.updateStatus('same-status', 'confirmed')

    expect(writes).toHaveLength(0)
  })
})
