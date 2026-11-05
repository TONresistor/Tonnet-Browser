import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { JournalStore } from './ports'
import { WalletEngineError } from './errors'

export const OperationPhaseSchema = z.enum([
  'ready',
  'submitting',
  'handed-off',
  'submitted',
  'unknown',
  'included',
  'expired',
  'seqno-consumed',
  'legacy-pending',
])
export type OperationPhase = z.infer<typeof OperationPhaseSchema>
export const OperationSchema = z.object({
  id: z.string().min(1).max(256),
  intentHash: z.string(),
  account: z.string(),
  phase: OperationPhaseSchema,
  seqno: z.number().int().nonnegative(),
  validUntil: z.number().int().positive(),
  context: z.string().optional(),
  requestHash: z.string().optional(),
  comment: z.string().optional(),
  commentEncrypted: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        address: z.string(),
        amount: z.string(),
        payload: z.string().optional(),
        stateInit: z.string().optional(),
        bounce: z.boolean().optional(),
      })
    )
    .default([]),
  estimatedFee: z.string().default('0'),
  boc: z.string().optional(),
  messageHash: z.string().optional(),
  normalizedHash: z.string().optional(),
  scan: z.object({ headLt: z.string(), headHash: z.string(), nextLt: z.string(), nextHash: z.string() }).optional(),
  closed: z.boolean().default(false),
  startedAt: z.number(),
  baselineLt: z.string(),
  baselineHash: z.string(),
  transactionHash: z.string().optional(),
  transactionLt: z.string().optional(),
  execution: z.enum(['succeeded', 'failed', 'partial', 'unknown']).optional(),
})
export type WalletOperation = z.infer<typeof OperationSchema>
const DocumentSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  revision: z.number().int().nonnegative(),
  operations: z.array(OperationSchema),
})
const EnvelopeSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  revision: z.number().int().positive(),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
})
export const isOperationPending = (op: WalletOperation): boolean => !op.closed
export function intentFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** One encrypted, versioned wallet-wide send slot. No signed bytes escape before save completes. */
export class OperationJournal {
  private key: Buffer | null = null
  private document: z.infer<typeof DocumentSchema> | null = null
  private epoch = 0
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly store: JournalStore) {}
  async open(secret: Buffer, account: string): Promise<void> {
    this.lock()
    const epoch = this.epoch
    const key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(account), 'tonnet-wallet-engine/journal/v1', 32))
    try {
      const raw = await this.store.read(account)
      let document: z.infer<typeof DocumentSchema>
      if (raw === null) document = { version: 1, account, revision: 0, operations: [] }
      else {
        if (raw.length > 32 * 1024 * 1024) throw new Error('Journal size exceeded')
        const envelope = EnvelopeSchema.parse(JSON.parse(raw.toString('utf8')))
        if (envelope.account !== account) throw new Error('Journal account mismatch')
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
        decipher.setAAD(Buffer.from(JSON.stringify([1, account, envelope.revision])))
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
        const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
        try {
          document = DocumentSchema.parse(JSON.parse(plaintext.toString('utf8')))
        } finally {
          plaintext.fill(0)
        }
        if (
          document.account !== account ||
          document.revision !== envelope.revision ||
          document.operations.some((op) => op.account !== account)
        )
          throw new Error('Journal metadata mismatch')
        if (new Set(document.operations.map((op) => op.id)).size !== document.operations.length)
          throw new Error('Duplicate operation identifiers')
      }
      if (epoch !== this.epoch) throw new WalletEngineError('WALLET_LOCKED', 'Wallet locked while reading journal')
      this.key = key
      this.document = document
    } catch (error) {
      key.fill(0)
      if (error instanceof WalletEngineError) throw error
      throw new WalletEngineError('JOURNAL_UNREADABLE', 'Unable to read the protected operation journal')
    }
  }
  lock(): void {
    this.epoch++
    this.key?.fill(0)
    this.key = null
    this.document = null
  }
  isOpen(): boolean {
    return this.key !== null && this.document !== null
  }
  list(): WalletOperation[] {
    return structuredClone(this.document?.operations ?? [])
  }
  get(id: string): WalletOperation | undefined {
    return this.list().find((op) => op.id === id)
  }
  pending(): WalletOperation | undefined {
    return this.list().find(isOperationPending)
  }
  save(operation: WalletOperation): Promise<void> {
    const epoch = this.epoch
    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (!this.key || !this.document || epoch !== this.epoch)
          throw new WalletEngineError('WALLET_LOCKED', 'Operation journal is locked')
        const current = this.document
        const next = structuredClone(current)
        const value = OperationSchema.parse(operation)
        if (value.account !== current.account)
          throw new WalletEngineError('IDENTITY_CHANGED', 'Operation account changed')
        const index = next.operations.findIndex((op) => op.id === value.id)
        if (index >= 0) {
          const previous = next.operations[index]
          if (previous.intentHash !== value.intentHash || previous.seqno !== value.seqno || previous.boc !== value.boc)
            throw new WalletEngineError('OPERATION_CONFLICT', 'Signed operation content is immutable')
          if (previous.closed) return
        }
        if (index < 0) next.operations.push(value)
        else next.operations[index] = value
        next.revision++
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', this.key, iv)
        cipher.setAAD(Buffer.from(JSON.stringify([1, current.account, next.revision])))
        const plaintext = Buffer.from(JSON.stringify(next))
        let ciphertext: Buffer
        try {
          ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
        } finally {
          plaintext.fill(0)
        }
        const envelope = Buffer.from(
          JSON.stringify({
            version: 1,
            account: current.account,
            revision: next.revision,
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            ciphertext: ciphertext.toString('base64'),
          })
        )
        if (envelope.length > 32 * 1024 * 1024)
          throw new WalletEngineError('JOURNAL_CAPACITY', 'Operation journal capacity exceeded')
        await this.store.compareExchange(current.account, current.revision, envelope)
        if (epoch !== this.epoch)
          throw new WalletEngineError('WALLET_LOCKED', 'Wallet locked during journal persistence')
        this.document = next
      })
    this.tail = run
    return run
  }
  async flush(): Promise<void> {
    await this.tail
  }
}
