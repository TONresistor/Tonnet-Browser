import { z } from 'zod'
import { defineEvent, defineRequest } from './definition'
import { WALLET_CONTRACT_CHANNELS } from './channels'
import { WALLET_MAX_COMMENT_BYTES } from '../constants'

export const WalletStateSchema = z.object({
  isCreated: z.boolean(),
  address: z.string(),
  addressRaw: z.string(),
  publicKey: z.string(),
  balance: z.string().regex(/^\d+$/),
  decryptFailed: z.boolean().optional(),
  weakEncryption: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  needsPasswordSetup: z.boolean().optional(),
  backupVerified: z.boolean().optional(),
  walletVersion: z.enum(['v3R1', 'v3R2', 'v4R2', 'v5R1']).optional(),
  mnemonicScheme: z.enum(['ton', 'bip39']).optional(),
})

export type WalletState = z.infer<typeof WalletStateSchema>

export const WalletTransactionSchema = z.object({
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

export const PaymentNotificationSchema = z.object({
  id: z.string().min(1).max(256),
  domain: z.string().min(1).max(253),
  url: z.string().max(16_384),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string().min(1),
  payToFriendly: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'completed', 'failed']),
  error: z.string().optional(),
})
export type PaymentNotification = z.infer<typeof PaymentNotificationSchema>

const RecoveryMnemonicSchema = z
  .array(z.string().min(1).max(32))
  .refine((words) => words.length === 12 || words.length === 24)
const WalletPasswordSchema = z.string().min(10).max(256)
const WalletVersionSchema = z.enum(['v3R1', 'v3R2', 'v4R2', 'v5R1'])
const MnemonicSchemeSchema = z.enum(['ton', 'bip39'])
export const WalletAccountCandidateSchema = z.object({
  scheme: MnemonicSchemeSchema,
  version: WalletVersionSchema,
  address: z.string().min(1),
  addressRaw: z.string().min(1),
  balance: z.string().regex(/^\d+$/).nullable(),
})
export type WalletAccountCandidate = z.infer<typeof WalletAccountCandidateSchema>
const MutationSchema = z.object({ success: z.literal(true) })
const mainBase = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}
const passwordRateLimit = { kind: 'fixed-window' as const, maxRequests: 5, windowMs: 60_000, key: 'sender' as const }

export const walletCreateContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.create,
  input: z.tuple([WalletPasswordSchema]),
  output: WalletStateSchema.extend({ mnemonic: RecoveryMnemonicSchema }),
  errors: ['WALLET_ALREADY_EXISTS', 'WALLET_CREATE_FAILED'],
  redaction: 'secret',
})

export const walletGetStateContract = defineRequest({
  channel: WALLET_CONTRACT_CHANNELS.getState,
  direction: 'request',
  caller: 'main-renderer',
  authorization: 'main-window',
  rateLimit: { kind: 'none' },
  input: z.tuple([]),
  output: WalletStateSchema,
  errors: ['WALLET_STATE_UNAVAILABLE'],
  redaction: 'sensitive',
})
export const walletGetBalanceContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.getBalance,
  input: z.tuple([]),
  output: z.string().regex(/^\d+$/),
  errors: ['WALLET_UNAVAILABLE', 'BALANCE_READ_FAILED'],
})
export const walletResolveRecipientContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.resolveRecipient,
  input: z.tuple([z.string().min(1).max(1_024)]),
  output: z.object({ address: z.string().min(1), domain: z.string().optional() }),
  errors: ['INVALID_RECIPIENT', 'DNS_RESOLUTION_FAILED', 'BRIDGE_DISCONNECTED'],
})
export const walletSendContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.send,
  input: z.tuple([
    z.string().min(1).max(1_024),
    z.string().regex(/^\d+$/),
    z
      .string()
      .refine((value) => new TextEncoder().encode(value).length <= WALLET_MAX_COMMENT_BYTES)
      .optional(),
  ]),
  output: WalletTransactionSchema,
  errors: [
    'WALLET_UNAVAILABLE',
    'BRIDGE_DISCONNECTED',
    'INVALID_RECIPIENT',
    'DNS_RESOLUTION_FAILED',
    'BALANCE_READ_FAILED',
    'INVALID_AMOUNT',
    'COMMENT_TOO_LONG',
    'INSUFFICIENT_BALANCE',
    'WALLET_LOCKED',
    'WALLET_PASSWORD_REQUIRED',
    'WALLET_BACKUP_REQUIRED',
    'USER_CANCELLED',
    'SIGNING_FAILED',
  ],
  redaction: 'secret',
})
export const walletGetHistoryContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.getHistory,
  input: z.tuple([z.number().int().min(1).max(1_000).optional()]),
  output: z.array(WalletTransactionSchema),
  errors: ['WALLET_HISTORY_FAILED'],
})
export const walletClearHistoryContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.clearHistory,
  input: z.tuple([]),
  output: z.object({ success: z.literal(true) }),
  errors: ['WALLET_HISTORY_CLEAR_FAILED'],
})
export const walletExportKeyContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.exportKey,
  input: z.tuple([]),
  output: z.object({ publicKey: z.string(), address: z.string(), addressRaw: z.string() }),
  errors: ['WALLET_NOT_FOUND'],
  redaction: 'sensitive',
})
const paymentDecision = <const TChannel extends string>(channel: TChannel) =>
  defineRequest({
    ...mainBase,
    channel,
    input: z.tuple([z.string().min(1).max(256)]),
    output: z.object({ success: z.literal(true) }),
    errors: ['INVALID_PAYMENT_ID', 'PAYMENT_DECISION_FAILED'],
  })
export const walletApprovePaymentContract = paymentDecision(WALLET_CONTRACT_CHANNELS.approvePayment)
export const walletRejectPaymentContract = paymentDecision(WALLET_CONTRACT_CHANNELS.rejectPayment)
export const walletPayForXhrContract = defineRequest({
  direction: 'request',
  channel: WALLET_CONTRACT_CHANNELS.payForXhr,
  caller: 'tonsite',
  authorization: 'owning-tonsite-session',
  rateLimit: { kind: 'fixed-window', maxRequests: 5, windowMs: 1_000, key: 'sender' },
  input: z.tuple([
    z.object({
      url: z
        .string()
        .url()
        .max(16_384)
        .refine((value) => {
          const protocol = new URL(value).protocol
          return protocol === 'http:' || protocol === 'https:'
        }),
    }),
  ]),
  output: MutationSchema,
  errors: ['RATE_LIMITED', 'INVALID_URL', 'CROSS_ORIGIN', 'PAYMENT_FAILED'],
  redaction: 'secret',
})
export const walletImportContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.importWallet,
  input: z.tuple([RecoveryMnemonicSchema, WalletPasswordSchema, WalletVersionSchema, MnemonicSchemeSchema]),
  output: WalletStateSchema,
  errors: ['INVALID_MNEMONIC', 'WALLET_IMPORT_FAILED', 'USER_CANCELLED'],
  redaction: 'secret',
})
export const walletDiscoverAccountsContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.discoverAccounts,
  input: z.tuple([RecoveryMnemonicSchema]),
  output: z.array(WalletAccountCandidateSchema).min(4).max(8),
  errors: ['INVALID_MNEMONIC', 'BRIDGE_DISCONNECTED', 'ACCOUNT_DISCOVERY_FAILED'],
  redaction: 'secret',
})
export const walletExportMnemonicContract = defineRequest({
  ...mainBase,
  rateLimit: passwordRateLimit,
  channel: WALLET_CONTRACT_CHANNELS.exportMnemonic,
  input: z.tuple([WalletPasswordSchema]),
  output: z.object({ mnemonic: RecoveryMnemonicSchema }),
  errors: ['USER_CANCELLED', 'MNEMONIC_UNAVAILABLE'],
  redaction: 'secret',
})
export const walletDeleteContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.deleteWallet,
  input: z.tuple([]),
  output: WalletStateSchema,
  errors: ['WALLET_NOT_FOUND', 'WALLET_DELETE_FAILED', 'USER_CANCELLED'],
  redaction: 'secret',
})
export const walletUnlockContract = defineRequest({
  ...mainBase,
  rateLimit: passwordRateLimit,
  channel: WALLET_CONTRACT_CHANNELS.unlock,
  input: z.tuple([WalletPasswordSchema]),
  output: WalletStateSchema,
  errors: ['WALLET_NOT_FOUND', 'INVALID_PASSWORD', 'WALLET_UNLOCK_FAILED'],
  redaction: 'secret',
})
export const walletLockContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.lock,
  input: z.tuple([]),
  output: WalletStateSchema,
  errors: ['WALLET_NOT_FOUND'],
})
export const walletSetupPasswordContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.setupPassword,
  input: z.tuple([WalletPasswordSchema]),
  output: WalletStateSchema,
  errors: ['WALLET_NOT_FOUND', 'WALLET_PASSWORD_SETUP_FAILED'],
  redaction: 'secret',
})
export const walletMarkBackupVerifiedContract = defineRequest({
  ...mainBase,
  rateLimit: passwordRateLimit,
  channel: WALLET_CONTRACT_CHANNELS.markBackupVerified,
  input: z.tuple([z.string().uuid(), WalletPasswordSchema, z.array(z.string().min(1).max(32)).length(3)]),
  output: WalletStateSchema,
  errors: ['WALLET_NOT_FOUND', 'BACKUP_VERIFICATION_FAILED'],
  redaction: 'secret',
})
export const walletCreateBackupChallengeContract = defineRequest({
  ...mainBase,
  rateLimit: passwordRateLimit,
  channel: WALLET_CONTRACT_CHANNELS.createBackupChallenge,
  input: z.tuple([WalletPasswordSchema]),
  output: z.object({
    challengeId: z.string().uuid(),
    indexes: z.array(z.number().int().min(0).max(23)).length(3),
  }),
  errors: ['WALLET_NOT_FOUND', 'INVALID_PASSWORD', 'BACKUP_CHALLENGE_FAILED'],
  redaction: 'secret',
})
export const walletChangePasswordContract = defineRequest({
  ...mainBase,
  rateLimit: passwordRateLimit,
  channel: WALLET_CONTRACT_CHANNELS.changePassword,
  input: z.tuple([WalletPasswordSchema, WalletPasswordSchema]),
  output: WalletStateSchema,
  errors: ['WALLET_NOT_FOUND', 'INVALID_PASSWORD', 'WALLET_PASSWORD_CHANGE_FAILED'],
  redaction: 'secret',
})
export const walletSensitiveDisplayContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.sensitiveDisplay,
  input: z.tuple([z.boolean()]),
  output: MutationSchema,
  errors: ['SENSITIVE_DISPLAY_FAILED'],
  redaction: 'sensitive',
})
export const dnsResolveContract = defineRequest({
  ...mainBase,
  channel: WALLET_CONTRACT_CHANNELS.dnsResolve,
  input: z.tuple([z.string().min(1).max(253)]),
  output: DnsResolveResultSchema,
  errors: ['INVALID_DOMAIN', 'DNS_RESOLUTION_FAILED', 'BRIDGE_DISCONNECTED'],
})

export const walletBalanceUpdatedContract = defineEvent({
  channel: WALLET_CONTRACT_CHANNELS.balanceUpdated,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([z.string().regex(/^\d+$/)]),
  redaction: 'sensitive',
})

export const walletStateChangedContract = defineEvent({
  channel: WALLET_CONTRACT_CHANNELS.stateChanged,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([WalletStateSchema]),
  redaction: 'sensitive',
})

export const walletNewTransactionContract = defineEvent({
  channel: WALLET_CONTRACT_CHANNELS.newTransaction,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([WalletTransactionSchema]),
  redaction: 'sensitive',
})

const paymentEvent = <const TChannel extends string>(channel: TChannel) =>
  defineEvent({
    channel,
    direction: 'event',
    recipient: 'main-renderer',
    payload: z.tuple([PaymentNotificationSchema]),
    redaction: 'secret',
  })
export const walletPaymentRequestedContract = paymentEvent(WALLET_CONTRACT_CHANNELS.paymentRequested)
export const walletPaymentMadeContract = paymentEvent(WALLET_CONTRACT_CHANNELS.paymentMade)
export const walletPaymentFailedContract = paymentEvent(WALLET_CONTRACT_CHANNELS.paymentFailed)

export const WALLET_EVENT_CONTRACTS = [
  walletBalanceUpdatedContract,
  walletStateChangedContract,
  walletNewTransactionContract,
  walletPaymentRequestedContract,
  walletPaymentMadeContract,
  walletPaymentFailedContract,
] as const

export const WALLET_REQUEST_CONTRACTS = [
  walletCreateContract,
  walletGetStateContract,
  walletGetBalanceContract,
  walletResolveRecipientContract,
  walletSendContract,
  walletGetHistoryContract,
  walletClearHistoryContract,
  walletExportKeyContract,
  walletApprovePaymentContract,
  walletRejectPaymentContract,
  walletPayForXhrContract,
  walletImportContract,
  walletDiscoverAccountsContract,
  walletExportMnemonicContract,
  walletDeleteContract,
  walletUnlockContract,
  walletLockContract,
  walletSetupPasswordContract,
  walletMarkBackupVerifiedContract,
  walletCreateBackupChallengeContract,
  walletChangePasswordContract,
  walletSensitiveDisplayContract,
  dnsResolveContract,
] as const
