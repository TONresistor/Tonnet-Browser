import { z } from 'zod'
import { defineEvent, defineRequest } from './definition'
import { COCOON_CHANNELS } from './channels'

const DecimalSchema = z.string().regex(/^\d+$/)
const AddressSchema = z.string().min(1).max(512)
const HashSchema = z.string().min(1).max(512)
const MnemonicSchema = z.array(z.string().min(1).max(32)).length(24)
const TimestampSchema = z.number().finite().nonnegative()
const SuccessSchema = z.object({ success: z.literal(true) })
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
const noArgs = z.tuple([])
const request = <const TChannel extends string, TOutput>(
  channel: TChannel,
  output: z.ZodType<TOutput>,
  errors: readonly string[],
  redaction: 'public' | 'sensitive' | 'secret' = 'sensitive'
) => defineRequest({ ...base, channel, input: noArgs, output, errors, redaction })

export const CocoonStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stopped') }),
  z.object({ kind: z.literal('starting'), phase: z.enum(['client-runner', 'sync', 'staking']) }),
  z.object({ kind: z.literal('ready'), httpPort: z.number().int().min(1).max(65_535) }),
  z.object({ kind: z.literal('crashed'), error: z.string() }),
])
export const CocoonAvailabilitySchema = z.union([
  z.object({ available: z.literal(true) }),
  z.object({ available: z.literal(false), reason: z.enum(['platform', 'arch', 'glibc']), message: z.string() }),
])
export const CocoonWalletInfoSchema = z.object({
  ownerAddress: AddressSchema,
  nodeAddress: AddressSchema,
  nodePublicKeyHex: z.string().regex(/^[0-9a-f]{64}$/i),
  createdAt: TimestampSchema,
  setupCompletedAt: TimestampSchema.nullable(),
})
export const CocoonStakeInfoSchema = z.object({
  status: z.enum(['active', 'closing', 'cooldown', 'refundable', 'closed']),
  proxySCAddress: AddressSchema,
  clientSCAddress: AddressSchema,
  runnerState: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  onchainState: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
  balance: DecimalSchema,
  stake: DecimalSchema,
  unlockTs: TimestampSchema,
  tokensUsed: DecimalSchema,
  tokensPayed: DecimalSchema,
  cocoonWalletBalance: DecimalSchema,
  runnerStatus: z.enum(['stopped', 'starting', 'ready', 'crashed']),
})
const CashoutTxSchema = z.object({ source: z.enum(['node', 'owner']), bocHash: HashSchema, sentAmount: DecimalSchema })
export const CocoonCashoutResultSchema = z.object({ totalSent: DecimalSchema, txs: z.array(CashoutTxSchema) })
export const CocoonPendingWithdrawSchema = z.object({
  startedAt: TimestampSchema,
  lastActionAt: TimestampSchema.optional(),
  lastBocHash: HashSchema.optional(),
})
export const RecoveryEntrySchema = z.object({
  archivedAt: TimestampSchema,
  clientSCAddress: AddressSchema,
  phase: z.enum(['refund-pending', 'cooldown', 'claim-pending', 'drain-pending', 'done', 'failed']),
  addedAt: TimestampSchema,
  lastError: z.string().optional(),
  unlockTs: TimestampSchema.optional(),
  refundBocHash: HashSchema.optional(),
  claimBocHash: HashSchema.optional(),
  drainBocHash: HashSchema.optional(),
  sentToMain: AddressSchema.optional(),
  lastActionAt: TimestampSchema.optional(),
})
const RecoveryAllTxSchema = z.object({
  source: z.enum([
    'current-node',
    'current-owner',
    'archived-node',
    'archived-owner',
    'client-refund-request',
    'client-refund-claim',
  ]),
  address: AddressSchema,
  amount: DecimalSchema,
  bocHash: HashSchema,
  archivedAt: TimestampSchema.optional(),
})
export const CocoonRecoveryAllResultSchema = z.object({
  success: z.literal(true),
  totalRequested: DecimalSchema,
  txs: z.array(RecoveryAllTxSchema),
  locked: z.array(
    z.object({ clientSCAddress: AddressSchema, unlockTs: TimestampSchema, archivedAt: TimestampSchema.optional() })
  ),
  skipped: z.array(
    z.object({ reason: z.string(), address: AddressSchema.optional(), archivedAt: TimestampSchema.optional() })
  ),
})

export const cocoonAvailabilityContract = request(
  COCOON_CHANNELS.availability,
  CocoonAvailabilitySchema,
  ['AVAILABILITY_FAILED'],
  'public'
)
export const cocoonStatusContract = request(COCOON_CHANNELS.status, CocoonStateSchema, ['STATUS_FAILED'], 'public')
export const cocoonStartContract = request(
  COCOON_CHANNELS.start,
  z.object({ success: z.literal(true), httpPort: z.number().int().min(1).max(65_535) }),
  ['ALREADY_STARTING', 'START_FAILED']
)
export const cocoonStopContract = request(COCOON_CHANNELS.stop, SuccessSchema, ['STOP_FAILED'])
export const cocoonWalletExistsContract = request(COCOON_CHANNELS.walletExists, z.boolean(), ['WALLET_READ_FAILED'])
export const cocoonWalletCreateContract = request(
  COCOON_CHANNELS.walletCreate,
  z.object({ ownerAddress: AddressSchema, nodeAddress: AddressSchema, mnemonic: MnemonicSchema }),
  ['WALLET_ALREADY_ACTIVE', 'WALLET_CREATE_FAILED'],
  'secret'
)
export const cocoonWalletInfoContract = request(COCOON_CHANNELS.walletInfo, CocoonWalletInfoSchema.nullable(), [
  'WALLET_READ_FAILED',
])
export const cocoonWalletExportMnemonicContract = request(
  COCOON_CHANNELS.walletExportMnemonic,
  MnemonicSchema,
  ['WALLET_NOT_FOUND'],
  'secret'
)
export const cocoonWalletDeleteContract = request(
  COCOON_CHANNELS.walletDelete,
  z.void(),
  ['WALLET_DELETE_FAILED'],
  'secret'
)
export const cocoonWalletMarkSetupCompleteContract = request(COCOON_CHANNELS.walletMarkSetupComplete, z.void(), [
  'WALLET_WRITE_FAILED',
])
export const cocoonOwnerBalanceContract = request(COCOON_CHANNELS.ownerBalance, DecimalSchema, [
  'BRIDGE_DISCONNECTED',
  'BALANCE_READ_FAILED',
])
export const cocoonNodeBalanceContract = request(COCOON_CHANNELS.nodeBalance, DecimalSchema, [
  'BRIDGE_DISCONNECTED',
  'BALANCE_READ_FAILED',
])
export const cocoonFundContract = defineRequest({
  ...base,
  channel: COCOON_CHANNELS.fund,
  input: z.tuple([z.object({ amount: z.union([z.literal('max'), DecimalSchema]) })]),
  output: z.object({ bocHash: HashSchema, seqno: z.number().int().nonnegative(), sentAmount: DecimalSchema }),
  errors: ['BRIDGE_DISCONNECTED', 'INVALID_AMOUNT', 'FUND_FAILED'],
  redaction: 'secret',
})
export const cocoonStakeInfoContract = request(COCOON_CHANNELS.stakeInfo, CocoonStakeInfoSchema.nullable(), [
  'BRIDGE_DISCONNECTED',
  'STAKE_READ_FAILED',
])
export const cocoonUnstakeContract = request(COCOON_CHANNELS.unstake, SuccessSchema, ['UNSTAKE_FAILED'])
export const cocoonCashoutContract = request(
  COCOON_CHANNELS.cashout,
  CocoonCashoutResultSchema,
  ['BRIDGE_DISCONNECTED', 'WALLET_NOT_FOUND', 'CASHOUT_FAILED'],
  'secret'
)
export const cocoonFlowStakeContract = request(
  COCOON_CHANNELS.flowStake,
  z.object({ success: z.literal(true), httpPort: z.number().int().min(1).max(65_535) }),
  ['ACTIVATION_FAILED'],
  'secret'
)
export const cocoonFlowUnstakeContract = request(
  COCOON_CHANNELS.flowUnstake,
  SuccessSchema,
  ['WITHDRAW_START_FAILED'],
  'secret'
)
export const cocoonFlowPendingContract = request(COCOON_CHANNELS.flowPending, CocoonPendingWithdrawSchema.nullable(), [
  'WITHDRAW_READ_FAILED',
])
export const cocoonArchiveListContract = request(
  COCOON_CHANNELS.archiveList,
  z.array(
    z.object({
      archivedAt: TimestampSchema,
      ownerAddress: AddressSchema,
      nodeAddress: AddressSchema,
      lastClientSCAddress: AddressSchema.nullable(),
    })
  ),
  ['ARCHIVE_READ_FAILED']
)
const ArchivedAtInputSchema = z.object({ archivedAt: TimestampSchema })
export const cocoonArchiveExportMnemonicContract = defineRequest({
  ...base,
  channel: COCOON_CHANNELS.archiveExportMnemonic,
  input: z.tuple([ArchivedAtInputSchema]),
  output: z.object({ mnemonic: MnemonicSchema }),
  errors: ['ARCHIVE_NOT_FOUND', 'ARCHIVE_READ_FAILED'],
  redaction: 'secret',
})
export const cocoonRecoveryEnqueueContract = defineRequest({
  ...base,
  channel: COCOON_CHANNELS.recoveryEnqueue,
  input: z.tuple([ArchivedAtInputSchema.extend({ clientSCAddress: AddressSchema })]),
  output: z.object({ success: z.literal(true), refundBocHash: HashSchema }),
  errors: ['ARCHIVE_NOT_FOUND', 'BRIDGE_DISCONNECTED', 'RECOVERY_ENQUEUE_FAILED'],
  redaction: 'secret',
})
export const cocoonRecoveryListContract = request(COCOON_CHANNELS.recoveryList, z.array(RecoveryEntrySchema), [
  'RECOVERY_READ_FAILED',
])
export const cocoonRecoveryRemoveContract = defineRequest({
  ...base,
  channel: COCOON_CHANNELS.recoveryRemove,
  input: z.tuple([ArchivedAtInputSchema]),
  output: SuccessSchema,
  errors: ['RECOVERY_REMOVE_FAILED'],
})
export const cocoonRecoveryAllContract = request(
  COCOON_CHANNELS.recoveryAll,
  CocoonRecoveryAllResultSchema,
  ['BRIDGE_DISCONNECTED', 'RECOVERY_FAILED'],
  'secret'
)

export const CocoonLogEventSchema = z.object({ source: z.literal('runner'), line: z.string() })
export const WithdrawDriverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), status: CocoonStakeInfoSchema.shape.status }),
  z.object({ type: z.literal('cashout-done'), sentAmount: DecimalSchema, bocHash: HashSchema }),
  z.object({ type: z.literal('completed') }),
  z.object({ type: z.literal('error'), message: z.string(), recoverable: z.boolean() }),
])
export const RecoveryDriverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), archivedAt: TimestampSchema, clientSCAddress: AddressSchema }),
  z.object({
    type: z.literal('cooldown'),
    archivedAt: TimestampSchema,
    clientSCAddress: AddressSchema,
    unlockTs: TimestampSchema,
  }),
  z.object({
    type: z.literal('claimed'),
    archivedAt: TimestampSchema,
    clientSCAddress: AddressSchema,
    bocHash: HashSchema,
  }),
  z.object({
    type: z.literal('drained'),
    archivedAt: TimestampSchema,
    clientSCAddress: AddressSchema,
    bocHash: HashSchema,
    sentAmount: DecimalSchema,
    sentTo: AddressSchema,
  }),
  z.object({ type: z.literal('done'), archivedAt: TimestampSchema, clientSCAddress: AddressSchema }),
  z.object({
    type: z.literal('failed'),
    archivedAt: TimestampSchema,
    clientSCAddress: AddressSchema,
    message: z.string(),
  }),
])
const event = <const TChannel extends string, TPayload>(
  channel: TChannel,
  payload: z.ZodType<TPayload>,
  redaction: 'public' | 'sensitive' | 'secret' = 'sensitive'
) => defineEvent({ channel, direction: 'event', recipient: 'main-renderer', payload: z.tuple([payload]), redaction })
export const cocoonStateChangedContract = event(COCOON_CHANNELS.stateChanged, CocoonStateSchema)
export const cocoonLogContract = event(COCOON_CHANNELS.log, CocoonLogEventSchema, 'secret')
export const cocoonWithdrawEventContract = event(COCOON_CHANNELS.withdrawEvent, WithdrawDriverEventSchema, 'secret')
export const cocoonRecoveryEventContract = event(COCOON_CHANNELS.recoveryEvent, RecoveryDriverEventSchema, 'secret')

export const COCOON_REQUEST_CONTRACTS = [
  cocoonAvailabilityContract,
  cocoonStatusContract,
  cocoonStartContract,
  cocoonStopContract,
  cocoonWalletExistsContract,
  cocoonWalletCreateContract,
  cocoonWalletInfoContract,
  cocoonWalletExportMnemonicContract,
  cocoonWalletDeleteContract,
  cocoonWalletMarkSetupCompleteContract,
  cocoonOwnerBalanceContract,
  cocoonNodeBalanceContract,
  cocoonFundContract,
  cocoonStakeInfoContract,
  cocoonUnstakeContract,
  cocoonCashoutContract,
  cocoonFlowStakeContract,
  cocoonFlowUnstakeContract,
  cocoonFlowPendingContract,
  cocoonArchiveListContract,
  cocoonArchiveExportMnemonicContract,
  cocoonRecoveryEnqueueContract,
  cocoonRecoveryListContract,
  cocoonRecoveryRemoveContract,
  cocoonRecoveryAllContract,
] as const
export const COCOON_EVENT_CONTRACTS = [
  cocoonStateChangedContract,
  cocoonLogContract,
  cocoonWithdrawEventContract,
  cocoonRecoveryEventContract,
] as const

export type CocoonState = z.infer<typeof CocoonStateSchema>
export type CocoonAvailability = z.infer<typeof CocoonAvailabilitySchema>
export type CocoonWalletInfo = z.infer<typeof CocoonWalletInfoSchema>
export type CocoonStakeInfo = z.infer<typeof CocoonStakeInfoSchema>
export type CocoonCashoutResult = z.infer<typeof CocoonCashoutResultSchema>
export type CocoonPendingWithdraw = z.infer<typeof CocoonPendingWithdrawSchema>
export type RecoveryEntry = z.infer<typeof RecoveryEntrySchema>
export type CocoonRecoveryAllResult = z.infer<typeof CocoonRecoveryAllResultSchema>
export type CocoonLogEvent = z.infer<typeof CocoonLogEventSchema>
export type WithdrawDriverEvent = z.infer<typeof WithdrawDriverEventSchema>
export type RecoveryDriverEvent = z.infer<typeof RecoveryDriverEventSchema>
