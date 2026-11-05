export { WalletEngine } from './engine'
export type { WalletEngineOptions, WalletSnapshot } from './engine'
export type { DecryptCommentRequest } from './encrypted-comment'
export { isEncryptedCommentBody } from './encrypted-comment'
export type { SecureStorage, VaultPersistence, HistoryStore, BridgeProvider, JournalStore } from './ports'
export { WalletDecryptionError, WalletSystemStorageError } from './key-storage'
export { WalletEngineError } from './errors'
export { WalletHistoryManager } from './history'
export { WalletStateSchema, WalletTransactionSchema } from './schemas'
export type { WalletState, WalletTransaction, DnsResolveResult } from './schemas'
export type { WalletOperation, OperationPhase } from './journal'
export type { TransferIntent, TransferMessage, TransferReview, TransferAuthorization } from './transactions'
export type { WalletBridgePort } from './bridge-port'
export type {
  AccountInformationResult,
  EmulateTransactionResult,
  BridgeAccountState,
  BridgeMessage,
  BridgeTransaction,
  TonBridgePort,
  WalletChainSnapshot,
  WalletConfirmationReceipt,
} from './network-types'
export { isContractNotDeployedError } from './network-types'
export {
  WalletVersionSchema,
  discoverWalletAccounts,
  deriveWalletAccount,
  createWalletContract,
} from './wallet-versions'
export type {
  WalletVersion,
  MnemonicScheme,
  WalletAccountCandidate,
  WalletContractShape,
  SupportedWalletContract,
} from './wallet-versions'
export { sameWalletIdentity } from './wallet-identity'
export type { WalletIdentitySnapshot } from './wallet-identity'
export { WalletBackupVerifier } from './backup-verifier'
export { rawToFriendly, parseTransferTarget, parseMainnetAddress } from './address-utils'
export {
  normalizeComment,
  encodeCommentBody,
  decodeCommentBody,
  commentByteLength,
  isCommentWithinLimit,
} from './comment'
export type {
  SignDataPayloadInput,
  SignDataResult,
  TonProofReplyPayload,
  TonConnectOutMessage,
  TonConnectAccount,
} from './signing-types'
