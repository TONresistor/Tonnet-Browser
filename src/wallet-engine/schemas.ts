import { z } from 'zod'
export const WalletStateSchema = z.object({
  isCreated: z.boolean(),
  address: z.string(),
  addressRaw: z.string(),
  publicKey: z.string(),
  balance: z.string().regex(/^\d+$/),
  decryptFailed: z.boolean().optional(),
  systemStorageBlocked: z.boolean().optional(),
  weakEncryption: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  needsPasswordSetup: z.boolean().optional(),
  passwordProtected: z.boolean().optional(),
  backupVerified: z.boolean().optional(),
  walletVersion: z.enum(['v3R1', 'v3R2', 'v4R2', 'v5R1']).optional(),
})

export type WalletState = z.infer<typeof WalletStateSchema>

export const WalletTransactionSchema = z.object({
  execution: z.enum(['succeeded', 'failed', 'partial', 'unknown']).optional(),
  operationId: z.string().optional(),
  operationState: z.string().optional(),
  id: z.string().min(1),
  type: z.enum(['send', 'receive', 'x402']),
  amount: z.string().regex(/^\d+$/),
  address: z.string().min(1),
  timestamp: z.number().finite().nonnegative(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  hash: z.string().optional(),
  lt: z.string().optional(),
  fee: z.string().optional(),
  comment: z.string().optional(),
  commentEncrypted: z.boolean().optional(),
  x402Domain: z.string().optional(),
  x402Url: z.string().optional(),
})

export type WalletTransaction = z.infer<typeof WalletTransactionSchema>

export const DnsResolveResultSchema = z
  .object({
    wallet: z.string().nullable(),
    site_adnl: z.string().nullable(),
    has_storage: z.boolean(),
    storage_bag_id: z.string().nullable(),
    next_resolver: z.string().nullable(),
    owner: z.string().nullable(),
    nft_address: z.string().nullable(),
    collection: z.string().nullable(),
    editor: z.string().nullable(),
    initialized: z.boolean(),
    expiring_at: z.number().int().nonnegative().nullable(),
    text_records: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
export type DnsResolveResult = z.infer<typeof DnsResolveResultSchema>
