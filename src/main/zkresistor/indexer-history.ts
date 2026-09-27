import { z } from 'zod'
import type { GetTransactionsResult, TransactionCursor } from '@tonresistor/zkresistor-sdk'
import type { TonIndexerClient } from '../indexer/client'
const CanonicalTransactionHashSchema = z.string().regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/)
const ReplayOutMessageSchema = z.object({
  body: z.string().min(1).optional(),
  index: z.number().int().nonnegative(),
  isExternal: z.boolean(),
})
const ReplayTransactionSchema = z.object({
  lt: z.string().regex(/^(?:0|[1-9]\d*)$/),
  hash: CanonicalTransactionHashSchema,
  block_seqno: z.number().int().nonnegative(),
  success: z.boolean(),
  out_msgs: z.array(ReplayOutMessageSchema),
})
export const ZkResistorTransactionsResultSchema = z.object({
  transactions: z.array(ReplayTransactionSchema),
  incomplete: z.boolean(),
})

export async function fetchReplayTransactionsViaIndexer(
  indexer: TonIndexerClient,
  address: string,
  limit: number,
  before: TransactionCursor | undefined
): Promise<GetTransactionsResult> {
  const transactions = await indexer.getTransactions({
    account: address,
    limit,
    sort: 'desc',
    ...(before ? { beforeLt: before.lt } : {}),
  })
  return ZkResistorTransactionsResultSchema.parse({
    transactions: transactions.map((transaction) => ({
      lt: transaction.lt,
      hash: transaction.hash,
      block_seqno: transaction.block_ref.seqno,
      success: !transaction.description.aborted,
      out_msgs: transaction.out_msgs.map((message, index) => ({
        index,
        isExternal: !message.destination,
        ...(message.message_content?.body ? { body: message.message_content.body } : {}),
      })),
    })),
    incomplete: transactions.length === limit,
  }) as GetTransactionsResult
}
