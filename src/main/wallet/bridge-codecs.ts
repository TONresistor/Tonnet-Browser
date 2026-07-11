import { z } from 'zod'

const JsonRpcIdSchema = z.union([z.string(), z.number()])

export const JsonRpcInboundSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: JsonRpcIdSchema.optional(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number(), message: z.string().optional() }).optional(),
    event: z.string().min(1).optional(),
    data: z.unknown().optional(),
  })
  .refine((message) => message.id !== undefined || message.event !== undefined, {
    message: 'JSON-RPC message must contain an id or event',
  })

export const AccountBalanceResultSchema = z.object({
  balance: z.string().regex(/^\d+$/),
})

export const SeqnoResultSchema = z.object({
  seqno: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform((value) => Number(value)),
})

export const SendAndWatchResultSchema = z.object({
  subscription_id: z.string().min(1),
  msg_hash: z.string().min(1),
})

export const SubscriptionResultSchema = z.object({
  subscription_id: z.string().min(1),
})

const DecimalSchema = z.string().regex(/^\d+$/)

export const BridgeAccountStateSchema = z.object({
  balance: DecimalSchema,
  last_transaction_lt: z.string(),
  last_transaction_hash: z.string(),
  seqno: z.number().int().nonnegative(),
})
export type BridgeAccountState = z.infer<typeof BridgeAccountStateSchema>

const BridgeMessageSchema = z.object({
  source: z.string(),
  destination: z.string(),
  value: DecimalSchema,
  body: z.string().optional(),
})

export const BridgeTransactionSchema = z.object({
  hash: z.string().min(1),
  lt: z.string().min(1),
  now: z.number().int().nonnegative(),
  total_fees: DecimalSchema.optional(),
  in_msg: BridgeMessageSchema.optional(),
  out_msgs: z.array(BridgeMessageSchema).optional(),
})
export type BridgeTransaction = z.infer<typeof BridgeTransactionSchema>

export const BridgeTransactionsResultSchema = z.object({
  transactions: z.array(BridgeTransactionSchema).optional(),
})

export const TxConfirmedEventSchema = z.object({
  msg_hash: z.string().min(1),
  transaction: z.object({ hash: z.string().min(1) }).optional(),
})

export const TxTimeoutEventSchema = z.object({
  msg_hash: z.string().min(1),
  reason: z.string().optional(),
})

export const OverlayMessageEventSchema = z.object({
  overlay_id: z.string().min(1),
  message: z.string(),
  trusted: z.boolean().optional(),
})

export const AdnlConnectionResultSchema = z.object({ peer_id: z.string().min(1) })

export const DhtValueResultSchema = z.object({ data: z.string(), ttl: z.number().int().nonnegative() }).nullable()

const NullableStringSchema = z.string().nullable().optional()
export const DnsResolveResultSchema = z
  .object({
    wallet: NullableStringSchema,
    site_adnl: NullableStringSchema,
    site: NullableStringSchema,
    has_storage: z.boolean().optional(),
    storage: z.boolean().optional(),
    storage_bag_id: NullableStringSchema,
    dns_storage_bag_id: NullableStringSchema,
    bag_id: NullableStringSchema,
    next_resolver: NullableStringSchema,
    dns_next_resolver: NullableStringSchema,
    next: NullableStringSchema,
    owner: NullableStringSchema,
    nft_address: NullableStringSchema,
    collection: NullableStringSchema,
    editor: NullableStringSchema,
    initialized: z.boolean().optional(),
    expiring_at: z.number().int().nonnegative().nullable().optional(),
    text_records: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()
