import { z } from 'zod'
import { SafeStorageWrapper } from '../history/safe-storage-wrapper'

const LeaseSchema = z.object({ seqno: z.number().int().nonnegative(), validUntil: z.number().int().positive() })
const LeaseFileSchema = z.object({ leases: z.record(z.string(), LeaseSchema) })
type Lease = z.infer<typeof LeaseSchema>
type LeaseFile = z.infer<typeof LeaseFileSchema>

export interface SeqnoLeasePersistence {
  read(): Promise<LeaseFile | null>
  write(data: LeaseFile): Promise<void>
  exists(): Promise<boolean>
}

export class PendingWalletTransactionError extends Error {
  constructor(readonly validUntil: number) {
    super('A wallet transaction is already pending')
    this.name = 'PendingWalletTransactionError'
  }
}

export class SeqnoLeaseManager {
  private leases: Record<string, Lease> | null = null

  constructor(
    private readonly persistence: SeqnoLeasePersistence = new SafeStorageWrapper<LeaseFile>('wallet-seqno-leases', {
      version: 1,
      migrate: (raw) => raw,
      parse: (raw) => LeaseFileSchema.parse(raw),
    }),
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  async observe(addressRaw: string, onChainSeqno: number, nowSeconds = this.nowSeconds()): Promise<Lease | null> {
    const leases = await this.load()
    const active = leases[addressRaw]
    if (!active) return null
    if (onChainSeqno > active.seqno || nowSeconds >= active.validUntil) {
      delete leases[addressRaw]
      await this.persist()
      return null
    }
    return active
  }

  async acquire(addressRaw: string, onChainSeqno: number, validUntil: number): Promise<number> {
    const active = await this.observe(addressRaw, onChainSeqno)
    if (active) throw new PendingWalletTransactionError(active.validUntil)
    const leases = await this.load()
    leases[addressRaw] = { seqno: onChainSeqno, validUntil }
    await this.persist()
    return onChainSeqno
  }

  async release(addressRaw: string, seqno: number): Promise<void> {
    const leases = await this.load()
    if (leases[addressRaw]?.seqno !== seqno) return
    delete leases[addressRaw]
    await this.persist()
  }

  resetMemory(): void {
    this.leases = null
  }

  private async load(): Promise<Record<string, Lease>> {
    if (this.leases) return this.leases
    const stored = await this.persistence.read()
    if (!stored && (await this.persistence.exists())) {
      throw new Error('Pending transaction state is unreadable')
    }
    this.leases = stored?.leases ?? {}
    return this.leases
  }

  private persist(): Promise<void> {
    return this.persistence.write({ leases: this.leases ?? {} })
  }
}
