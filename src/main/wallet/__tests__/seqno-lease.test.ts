import { describe, expect, it } from 'vitest'
import { PendingWalletTransactionError, SeqnoLeaseManager, type SeqnoLeasePersistence } from '../seqno-lease'

function memoryPersistence(initial: unknown = null): SeqnoLeasePersistence & { data: unknown } {
  return {
    data: initial,
    async read() {
      return this.data as Awaited<ReturnType<SeqnoLeasePersistence['read']>>
    },
    async write(data) {
      this.data = structuredClone(data)
    },
    async exists() {
      return this.data !== null
    },
  }
}

describe('SeqnoLeaseManager', () => {
  const address = `0:${'11'.repeat(32)}`

  it('persists a pending seqno and prevents reuse after restart', async () => {
    const persistence = memoryPersistence()
    const first = new SeqnoLeaseManager(persistence, () => 1_000)
    await expect(first.acquire(address, 7, 1_300)).resolves.toBe(7)

    const reopened = new SeqnoLeaseManager(persistence, () => 1_000)
    await expect(reopened.acquire(address, 7, 1_300)).rejects.toBeInstanceOf(PendingWalletTransactionError)
  })

  it('releases the lease when the chain advances', async () => {
    const leases = new SeqnoLeaseManager(memoryPersistence(), () => 1_000)
    await leases.acquire(address, 7, 1_300)
    await expect(leases.observe(address, 8, 1_100)).resolves.toBeNull()
    await expect(leases.acquire(address, 8, 1_400)).resolves.toBe(8)
  })

  it('releases expired or explicitly failed leases', async () => {
    const leases = new SeqnoLeaseManager(memoryPersistence(), () => 1_000)
    await leases.acquire(address, 7, 1_001)
    await expect(leases.observe(address, 7, 1_001)).resolves.toBeNull()
    await leases.acquire(address, 7, 1_100)
    await leases.release(address, 7)
    await expect(leases.acquire(address, 7, 1_200)).resolves.toBe(7)
  })

  it('fails closed when persisted pending state is unreadable', async () => {
    const persistence = memoryPersistence({ corrupt: true })
    persistence.read = async () => null
    await expect(new SeqnoLeaseManager(persistence).observe(address, 0)).rejects.toThrow(
      'Pending transaction state is unreadable'
    )
  })
})
