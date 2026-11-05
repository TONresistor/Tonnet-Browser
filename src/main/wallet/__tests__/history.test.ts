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
import { WalletHistoryManager as CoreHistory } from '../../../wallet-engine'

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

  it('keeps engine execution evidence when a late HTTP response updates the entry', async () => {
    const resolved = tx({
      id: 'payment',
      type: 'x402',
      operationId: 'payment',
      operationState: 'included',
      execution: 'failed',
      status: 'failed',
    })
    storageBackend.data = [resolved]
    const manager = new WalletHistoryManager()
    await manager.add(
      tx({ id: 'payment', type: 'x402', operationId: 'payment', status: 'pending', x402Domain: 'shop.ton' })
    )
    await manager.updateStatus('payment', 'confirmed')
    expect((await manager.getAll())[0]).toMatchObject({ ...resolved, x402Domain: 'shop.ton' })
  })

  it('keeps snapshot copies independent of subsequent cache mutations', async () => {
    storageBackend.data = [tx()]
    const manager = new WalletHistoryManager()
    await manager.getAll()
    const before = manager.snapshot()
    const changed = vi.fn()
    const dispose = manager.onChanged(changed)
    await manager.updateStatus('id', 'pending')
    expect(before[0].status).toBe('confirmed')
    expect(manager.snapshot()[0].status).toBe('pending')
    expect(changed).toHaveBeenCalledOnce()
    dispose()
  })

  it('does not restore a disk read that finishes after history has been cleared', async () => {
    let finish!: (value: WalletTransaction[]) => void
    storageBackend.data = new Promise((resolve) => {
      finish = resolve
    })
    const manager = new WalletHistoryManager()
    const reading = manager.getAll()
    await manager.clear()
    finish([tx()])
    expect(await reading).toEqual([])
    expect(manager.snapshot()).toEqual([])
  })

  it('serializes an address migration before a later clear', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let stored: WalletTransaction[] | null = [tx({ address: '0:' + '11'.repeat(32) })]
    const write = vi.fn(async (value: WalletTransaction[]) => {
      await pending
      stored = structuredClone(value)
    })
    const remove = vi.fn(async () => {
      stored = null
    })
    const manager = new CoreHistory({ read: async () => stored, write, delete: remove })
    const reading = manager.getAll()
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    const clearing = manager.clear()
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(remove).not.toHaveBeenCalled()
    } finally {
      finish()
      await Promise.all([reading, clearing])
    }
    expect(manager.snapshot()).toEqual([])
    expect(stored).toBeNull()
  })

  it.each(['add', 'updateStatus', 'reconcile'] as const)(
    'migrates inside %s without waiting on its own write queue',
    async (operation) => {
      let stored: WalletTransaction[] | null = [tx({ address: '0:' + '11'.repeat(32) })]
      const manager = new CoreHistory({
        read: async () => stored,
        write: async (value) => {
          stored = structuredClone(value)
        },
        delete: async () => {
          stored = null
        },
      })
      if (operation === 'add') await manager.add(tx({ id: 'new', hash: 'NEW' }))
      else if (operation === 'updateStatus') await manager.updateStatus('id', 'pending')
      else await manager.reconcile([tx({ hash: 'HASH1', status: 'pending' })])
      expect(manager.snapshot().find((entry) => entry.id === 'id')?.address).not.toContain(':')
      expect(stored).toEqual(manager.snapshot())
    }
  )
})
