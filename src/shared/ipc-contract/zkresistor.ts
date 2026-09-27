import { z } from 'zod'
import { ZKRESISTOR_CHANNELS } from './channels'
import { defineRequest } from './definition'

export const ZkResistorPoolSchema = z.object({
  id: z.string().min(1),
  address: z.string().min(1),
  kind: z.literal('ton'),
  symbol: z.literal('GRAM'),
  name: z.literal('GRAM'),
  denomination: z.string().regex(/^\d+$/),
  decimals: z.literal(9),
  nextIndex: z.number().int().nonnegative(),
  withdrawalCount: z.number().int().nonnegative(),
  shieldedDeposits: z.number().int().nonnegative(),
  shieldedAmount: z.string().regex(/^\d+$/),
  capacity: z.number().int().positive(),
})

export type ZkResistorPool = z.infer<typeof ZkResistorPoolSchema>

export const ZkResistorCatalogSchema = z.object({
  factoryAddress: z.string().min(1),
  sdkVersion: z.literal('2.0.1'),
  loadedAt: z.string().datetime(),
  pools: z.array(ZkResistorPoolSchema),
})

export type ZkResistorCatalog = z.infer<typeof ZkResistorCatalogSchema>

export const zkResistorCatalogContract = defineRequest({
  channel: ZKRESISTOR_CHANNELS.catalog,
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' as const },
  input: z.tuple([]),
  output: ZkResistorCatalogSchema,
  errors: ['FEATURE_DISABLED', 'BRIDGE_DISCONNECTED', 'ZKRESISTOR_CATALOG_FAILED'],
  redaction: 'public',
})

const PoolAddressSchema = z.string().min(1).max(128)
const DecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)$/)

export const ZkResistorResourceSchema = z.object({
  kind: z.literal('circuit'),
  name: z.enum(['hasher.wasm', 'insert.wasm', 'insert_final.zkey', 'withdraw.wasm', 'withdraw_final.zkey']),
})

export type ZkResistorResource = z.infer<typeof ZkResistorResourceSchema>

const mainBase = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
}

export const ZkResistorAccountStateSchema = z.object({
  status: z.string().min(1),
  balance: DecimalSchema.optional(),
  code: z.string().min(1).optional(),
  data: z.string().min(1).optional(),
})

export const zkResistorAccountContract = defineRequest({
  ...mainBase,
  channel: ZKRESISTOR_CHANNELS.account,
  input: z.tuple([PoolAddressSchema]),
  output: ZkResistorAccountStateSchema,
  errors: ['FEATURE_DISABLED', 'BRIDGE_DISCONNECTED', 'INVALID_ZKRESISTOR_POOL', 'ZKRESISTOR_STATE_FAILED'],
  redaction: 'public',
})

const ReplayPositionSchema = z.object({
  blockSeqno: z.number().int().nonnegative(),
  transactionLt: DecimalSchema,
  eventIndex: z.number().int().nonnegative(),
})

const MerkleCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  poolAddress: PoolAddressSchema,
  position: ReplayPositionSchema,
  nextIndex: z.number().int().nonnegative(),
  withdrawalCount: z.number().int().nonnegative(),
  currentRoot: DecimalSchema,
  commitmentSeenRoots: z.array(DecimalSchema).length(256),
  nullifierSpentRoots: z.array(DecimalSchema).length(256),
})

const MerklePathSchema = z.object({
  pathElements: z.array(DecimalSchema).length(20),
  pathIndices: z.array(z.union([z.literal(0), z.literal(1)])).length(20),
})

const MerkleSyncTargetSchema = z.object({
  poolAddress: PoolAddressSchema,
  nextIndex: z.number().int().nonnegative(),
  withdrawalCount: z.number().int().nonnegative(),
  currentRoot: DecimalSchema,
})

export const ZkResistorMerkleRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('sync'), poolAddress: PoolAddressSchema, target: MerkleSyncTargetSchema }),
  z.object({ operation: z.literal('checkpoint'), poolAddress: PoolAddressSchema }),
  z.object({
    operation: z.literal('insertionPath'),
    poolAddress: PoolAddressSchema,
    nextIndex: z.number().int().nonnegative(),
  }),
  z.object({
    operation: z.literal('membershipPath'),
    poolAddress: PoolAddressSchema,
    leafIndex: z.number().int().nonnegative(),
  }),
  z.object({
    operation: z.literal('sparseSetWitness'),
    poolAddress: PoolAddressSchema,
    setId: z.enum(['commitment', 'nullifier']),
    key: DecimalSchema,
  }),
])

export type ZkResistorMerkleRequest = z.infer<typeof ZkResistorMerkleRequestSchema>

export const ZkResistorMerkleResultSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('sync'), checkpoint: MerkleCheckpointSchema }),
  z.object({ operation: z.literal('checkpoint'), checkpoint: MerkleCheckpointSchema }),
  z.object({
    operation: z.literal('insertionPath'),
    nextIndex: z.number().int().nonnegative(),
    currentRoot: DecimalSchema,
    path: MerklePathSchema,
  }),
  z.object({
    operation: z.literal('membershipPath'),
    leafIndex: z.number().int().nonnegative(),
    currentRoot: DecimalSchema,
    path: MerklePathSchema,
  }),
  z.object({
    operation: z.literal('sparseSetWitness'),
    setId: z.enum(['commitment', 'nullifier']),
    domain: z.number().int().nonnegative(),
    key: DecimalSchema,
    bucketId: z.number().int().min(0).max(255),
    storedRoot: DecimalSchema,
    proof: z.object({
      expectedRoot: DecimalSchema,
      siblingBitmap: DecimalSchema,
      siblings: z.array(DecimalSchema).max(247),
    }),
  }),
])

export type ZkResistorMerkleResult = z.infer<typeof ZkResistorMerkleResultSchema>

export const zkResistorMerkleContract = defineRequest({
  ...mainBase,
  channel: ZKRESISTOR_CHANNELS.merkle,
  input: z.tuple([ZkResistorMerkleRequestSchema]),
  output: ZkResistorMerkleResultSchema,
  errors: [
    'ZKRESISTOR_RESOURCES_NOT_READY',
    'ZKRESISTOR_INDEXER_REQUIRED',
    'FEATURE_DISABLED',
    'BRIDGE_DISCONNECTED',
    'INVALID_ZKRESISTOR_POOL',
    'ZKRESISTOR_STATE_FAILED',
  ],
  redaction: 'sensitive',
})

export const zkResistorResourceContract = defineRequest({
  ...mainBase,
  channel: ZKRESISTOR_CHANNELS.resource,
  input: z.tuple([ZkResistorResourceSchema]),
  output: z.object({
    base64: z
      .string()
      .min(1)
      .max(64 * 1024 * 1024),
  }),
  errors: ['FEATURE_DISABLED', 'ZKRESISTOR_RESOURCE_FAILED'],
  redaction: 'sensitive',
})

export const ZkResistorSendRequestSchema = z.object({
  operation: z.enum(['deposit', 'withdraw']),
  poolAddress: z.string().min(1).max(128),
  value: z.string().regex(/^[1-9]\d*$/),
  payload: z
    .string()
    .min(1)
    .max(128 * 1024),
})
export type ZkResistorSendRequest = z.infer<typeof ZkResistorSendRequestSchema>

export const zkResistorSendContract = defineRequest({
  ...mainBase,
  channel: ZKRESISTOR_CHANNELS.send,
  input: z.tuple([ZkResistorSendRequestSchema]),
  output: z.object({ boc: z.string().min(1) }),
  errors: [
    'ZKRESISTOR_RESOURCES_NOT_READY',
    'FEATURE_DISABLED',
    'WALLET_UNAVAILABLE',
    'WALLET_PASSWORD_REQUIRED',
    'WALLET_LOCKED',
    'WALLET_BACKUP_REQUIRED',
    'BRIDGE_DISCONNECTED',
    'INVALID_ZKRESISTOR_TRANSACTION',
    'TRANSFER_PREFLIGHT_FAILED',
    'INSUFFICIENT_BALANCE',
    'USER_CANCELLED',
    'SIGNING_FAILED',
  ],
  redaction: 'sensitive',
})

const ZkResistorResourceStatusSchema = z.object({
  status: z.enum(['idle', 'downloading', 'ready', 'error']),
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  error: z.string().nullable(),
})
export type ZkResistorResourceStatus = z.infer<typeof ZkResistorResourceStatusSchema>
export const zkResistorResourceStatusContract = defineRequest({
  ...mainBase,
  channel: ZKRESISTOR_CHANNELS.resourceStatus,
  input: z.tuple([]),
  output: ZkResistorResourceStatusSchema,
  errors: ['FEATURE_DISABLED'],
  redaction: 'public',
})
export const zkResistorPrepareResourcesContract = defineRequest({
  ...mainBase,
  channel: ZKRESISTOR_CHANNELS.prepareResources,
  input: z.tuple([]),
  output: ZkResistorResourceStatusSchema,
  errors: ['FEATURE_DISABLED'],
  redaction: 'public',
})
