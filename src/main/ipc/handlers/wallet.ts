/**
 * IPC handlers for wallet operations.
 */

import type { DnsResolveResult, WalletState, WalletTransaction } from '../../../shared/types'
import { app, systemPreferences } from 'electron'
import { toError, log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import { getMainWindow } from '../../windows/main'
import { WALLET_HISTORY_DEFAULT_LIMIT } from '../../wallet/constants'
import { isTonDomain } from '../../../shared/utils/ton'
import type { ServiceRegistry } from '../../services'
import {
  walletBalanceUpdatedContract,
  walletGetStateContract,
  walletGetSnapshotContract,
  walletDecryptCommentContract,
  walletSnapshotChangedContract,
  walletRetrySystemStorageContract,
  walletNewTransactionContract,
  walletStateChangedContract,
  walletApprovePaymentContract,
  walletClearHistoryContract,
  walletCreateContract,
  walletDeleteContract,
  walletForgetContract,
  walletExportKeyContract,
  walletExportMnemonicContract,
  walletGetBalanceContract,
  walletGetHistoryContract,
  walletImportContract,
  walletDiscoverAccountsContract,
  walletPayForXhrContract,
  walletRejectPaymentContract,
  walletResolveRecipientContract,
  walletSendContract,
  walletRetryOperationContract,
  walletUnlockContract,
  walletLockContract,
  walletSetupPasswordContract,
  walletMarkBackupVerifiedContract,
  walletCreateBackupChallengeContract,
  walletChangePasswordContract,
  walletPageOpenContract,
  walletSensitiveDisplayContract,
  dnsResolveContract,
} from '../../../shared/ipc-contract/wallet'
import { WALLET_SYSTEM_STORAGE_RETRY_TOKEN } from '../../../shared/constants'
import { ipcFailure, ownIpcEmitterListener, secureContractHandle, tonsiteContractHandle } from '../contract-handler'
import {
  requestWalletDeletionApproval,
  requestWalletForgetApproval,
  requestWalletReplacementApproval,
  requestWalletTransferApproval,
} from '../../wallet/wallet-approval'
import { deriveWalletAccount, discoverWalletAccounts } from '../../wallet/wallet-versions'
import { WalletDecryptionError, WalletEngineError } from '../../../wallet-engine'

export function registerWalletHandlers(registry: ServiceRegistry): void {
  const { walletManager, tonBridgeProviders, paymentInterceptor, overlayManager, tonConnectService } = registry
  const clearAccountScopedState = async (): Promise<void> => {
    const results = await Promise.allSettled([tonConnectService.clearSessions()])
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn(`Failed to clear account-scoped state: ${toError(result.reason).message}`)
      }
    }
  }
  const getViewSnapshot = () => walletGetSnapshotContract.output.parse(walletManager.snapshot())

  ownIpcEmitterListener(walletManager, 'balance-updated', (balance: string) => {
    emitContractToRenderer(walletBalanceUpdatedContract, balance)
  })

  ownIpcEmitterListener(walletManager, 'state-changed', (state: WalletState) => {
    emitContractToRenderer(walletStateChangedContract, state)
  })

  ownIpcEmitterListener(walletManager, 'snapshot-changed', () => {
    emitContractToRenderer(walletSnapshotChangedContract, getViewSnapshot())
  })

  ownIpcEmitterListener(walletManager, 'new-transaction', (tx: WalletTransaction) => {
    emitContractToRenderer(walletNewTransactionContract, tx)
  })

  secureContractHandle(walletCreateContract, async ({ password }) => {
    if (walletManager.getState().isCreated) ipcFailure('WALLET_ALREADY_EXISTS', 'Wallet already exists')
    try {
      return await walletManager.create({ password })
    } catch (error) {
      const message = toError(error).message
      if (message === 'Wallet already exists') {
        ipcFailure('WALLET_ALREADY_EXISTS', 'Wallet already exists', false, error)
      }
      if (message.toLowerCase().includes('password') && message.toLowerCase().includes('required')) {
        ipcFailure('WALLET_PASSWORD_REQUIRED', 'An app password is required on this system', false, error)
      }
      ipcFailure('WALLET_CREATE_FAILED', 'Unable to create wallet', false, error)
    }
  })

  secureContractHandle(walletGetStateContract, () => {
    return walletManager.getState()
  })

  secureContractHandle(walletGetSnapshotContract, getViewSnapshot)

  secureContractHandle(walletDecryptCommentContract, async (request) => {
    if (walletManager.getState().isLocked) ipcFailure('WALLET_LOCKED', 'Unlock the wallet to decrypt this comment')
    try {
      return await walletManager.decryptComment(request)
    } catch (error) {
      ipcFailure('ENCRYPTED_COMMENT_UNAVAILABLE', 'Unable to decrypt this comment', false, error)
    }
  })

  secureContractHandle(walletRetrySystemStorageContract, () => {
    if (!walletManager.getState().systemStorageBlocked) {
      ipcFailure('WALLET_SYSTEM_STORAGE_AVAILABLE', 'System secure storage is already available')
    }
    const retryArgument = `--${WALLET_SYSTEM_STORAGE_RETRY_TOKEN}`
    const args = [...process.argv.slice(1).filter((argument) => argument !== retryArgument), retryArgument]
    app.relaunch({ args })
    app.quit()
    return { success: true as const }
  })

  secureContractHandle(walletGetBalanceContract, async () => {
    if (!walletManager.getState().isCreated) ipcFailure('WALLET_UNAVAILABLE', 'Wallet is not initialized')
    try {
      return await walletManager.getBalance()
    } catch (error) {
      ipcFailure('BALANCE_READ_FAILED', 'Unable to read wallet balance', false, error)
    }
  })

  secureContractHandle(walletResolveRecipientContract, async (input) => {
    try {
      return await walletManager.resolveRecipient(input)
    } catch (error) {
      const message = toError(error).message
      const code =
        message === 'Bridge not connected'
          ? 'BRIDGE_DISCONNECTED'
          : isTonDomain(input)
            ? 'DNS_RESOLUTION_FAILED'
            : 'INVALID_RECIPIENT'
      ipcFailure(
        code,
        code === 'BRIDGE_DISCONNECTED'
          ? 'Bridge not connected'
          : code === 'DNS_RESOLUTION_FAILED'
            ? 'Unable to resolve recipient domain'
            : 'Invalid recipient',
        false,
        code === 'INVALID_RECIPIENT' ? undefined : error
      )
    }
  })

  secureContractHandle(
    walletSendContract,
    async (to, amount, comment?: string, encryptedComment = false, operationId?: string) => {
      const state = walletManager.getState()
      if (!state.isCreated) ipcFailure('WALLET_UNAVAILABLE', 'Wallet is not initialized')
      if (state.needsPasswordSetup) ipcFailure('WALLET_PASSWORD_REQUIRED', 'Set a wallet password before sending')
      if (state.isLocked) ipcFailure('WALLET_LOCKED', 'Unlock the wallet before sending')
      if (!state.backupVerified) ipcFailure('WALLET_BACKUP_REQUIRED', 'Verify the wallet backup before sending')
      if (!tonBridgeProviders.wallet.getBridge()) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
      const walletIdentity = walletManager.getIdentitySnapshot()
      if (!walletIdentity) ipcFailure('WALLET_UNAVAILABLE', 'Wallet identity is unavailable')
      if (BigInt(amount) <= 0n) ipcFailure('INVALID_AMOUNT', 'Amount must be greater than zero')
      const approvalId = `wallet-transfer-${crypto.randomUUID()}`
      try {
        return await walletManager.sendNative(
          { to, amount, comment, encrypted: encryptedComment, operationId: operationId ?? crypto.randomUUID() },
          async (review) =>
            requestWalletTransferApproval(
              overlayManager,
              {
                address: review.messages[0].address,
                amount: review.messages[0].amount,
                domain: review.domain,
                comment: review.comment,
                commentEncrypted: review.commentEncrypted,
                estimatedFee: review.estimatedFee,
              },
              approvalId
            )
        )
      } catch (error) {
        if (
          error instanceof WalletEngineError &&
          [
            'INSUFFICIENT_BALANCE',
            'USER_CANCELLED',
            'TRANSFER_EXPIRED',
            'TRANSACTION_PENDING',
            'OPERATION_CONFLICT',
            'JOURNAL_UNREADABLE',
            'JOURNAL_LOCKED',
            'IDENTITY_CHANGED',
            'INVALID_ACCOUNT',
            'TRANSFER_PREFLIGHT_FAILED',
          ].includes(error.code)
        )
          ipcFailure(error.code, error.message, error.retryable, error.cause ?? error)
        ipcFailure('SIGNING_FAILED', 'Unable to prepare, authorize or send transaction', false, error)
      } finally {
        overlayManager.hide(approvalId)
      }
    }
  )

  secureContractHandle(walletRetryOperationContract, async (operationId) => {
    const approvalId = `wallet-retry-${crypto.randomUUID()}`
    try {
      return await walletManager.retryOperation(operationId, async (review) => {
        const decision = await requestWalletTransferApproval(
          overlayManager,
          {
            address: review.messages[0].address,
            amount: review.messages.reduce((total, message) => total + BigInt(message.amount), 0n).toString(),
            recipients: review.messages,
            estimatedFee: review.estimatedFee,
            readOnly: true,
            comment: walletManager.getOperation(operationId)?.comment,
            commentEncrypted: walletManager.getOperation(operationId)?.commentEncrypted,
          },
          approvalId
        )
        return decision.action === 'approve'
      })
    } catch (error) {
      ipcFailure('OPERATION_RETRY_FAILED', 'Unable to retry the signed operation', false, error)
    } finally {
      overlayManager.hide(approvalId)
    }
  })

  secureContractHandle(walletGetHistoryContract, async (limit?: number) => {
    const safeLimit = typeof limit === 'number' && limit > 0 ? limit : WALLET_HISTORY_DEFAULT_LIMIT
    try {
      return await walletManager.getHistory(safeLimit)
    } catch (error) {
      if (error instanceof WalletEngineError && error.code === 'SUPERSEDED')
        return getViewSnapshot().transactions.slice(0, safeLimit)
      ipcFailure('WALLET_HISTORY_FAILED', 'Unable to load wallet history', false, error)
    }
  })

  secureContractHandle(walletClearHistoryContract, async () => {
    try {
      await walletManager.clearHistory()
      return { success: true as const }
    } catch (error) {
      ipcFailure('WALLET_HISTORY_CLEAR_FAILED', 'Unable to clear wallet history', false, error)
    }
  })

  secureContractHandle(walletExportKeyContract, () => {
    const state = walletManager.getState()
    if (!state.isCreated) {
      ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    }
    // SECURITY: Only return public key, NEVER private key
    return { publicKey: state.publicKey, address: state.address, addressRaw: state.addressRaw }
  })

  secureContractHandle(walletApprovePaymentContract, async (paymentId) => {
    await paymentInterceptor.approvePayment(paymentId)
    return { success: true as const }
  })

  secureContractHandle(walletRejectPaymentContract, (paymentId) => {
    paymentInterceptor.rejectPayment(paymentId)
    return { success: true as const }
  })

  tonsiteContractHandle(
    walletPayForXhrContract,
    (event) => registry.tabManager.resolveSenderIdentity(event.sender),
    async (_domain, event, payload) => {
      const { url } = payload
      const sender = event.sender
      try {
        const reqOrigin = new URL(url).origin
        const pageOrigin = new URL(sender.getURL()).origin
        if (reqOrigin !== pageOrigin) {
          ipcFailure('CROSS_ORIGIN', 'Payment URL must match the page origin')
        }
        log.debug(`pay-for-xhr origin: ${reqOrigin}`)
      } catch {
        ipcFailure('INVALID_URL', 'Invalid payment URL')
      }
      const result = await paymentInterceptor.requestXhrPayment(sender.id, url)
      if (!result.success) ipcFailure('PAYMENT_FAILED', 'Payment could not be completed', false, result.error)
      return { success: true as const }
    }
  )

  secureContractHandle(walletDiscoverAccountsContract, async (mnemonic) => {
    const bridge = tonBridgeProviders.wallet.getBridge()
    if (!bridge) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
    try {
      return await discoverWalletAccounts(mnemonic, bridge)
    } catch (error) {
      const invalid = toError(error).message === 'Invalid mnemonic phrase'
      ipcFailure(
        invalid ? 'INVALID_MNEMONIC' : 'ACCOUNT_DISCOVERY_FAILED',
        invalid ? 'Invalid mnemonic phrase' : 'Unable to discover wallet accounts',
        false,
        invalid ? undefined : error
      )
    } finally {
      mnemonic.fill('')
    }
  })

  secureContractHandle(walletImportContract, async (mnemonic, password, walletVersion) => {
    const current = walletManager.getState()
    if (current.isCreated || current.decryptFailed) {
      let replacement: Awaited<ReturnType<typeof deriveWalletAccount>>
      try {
        replacement = await deriveWalletAccount(mnemonic, walletVersion)
      } catch {
        ipcFailure('INVALID_MNEMONIC', 'Invalid mnemonic phrase')
      }
      if (!(await requestWalletReplacementApproval(overlayManager, current.address, replacement))) {
        ipcFailure('USER_CANCELLED', 'Wallet import cancelled')
      }
    }
    paymentInterceptor.clearAccountState()
    let result: WalletState
    try {
      result = await walletManager.importWallet(mnemonic, password, walletVersion)
    } catch (error) {
      const message = toError(error).message
      const code =
        message === 'Invalid mnemonic phrase'
          ? 'INVALID_MNEMONIC'
          : message.toLowerCase().includes('password') && message.toLowerCase().includes('required')
            ? 'WALLET_PASSWORD_REQUIRED'
            : 'WALLET_IMPORT_FAILED'
      ipcFailure(
        code,
        code === 'INVALID_MNEMONIC'
          ? 'Invalid mnemonic phrase'
          : code === 'WALLET_PASSWORD_REQUIRED'
            ? 'An app password is required on this system'
            : 'Unable to import wallet',
        false,
        code === 'INVALID_MNEMONIC' ? undefined : error
      )
    }
    await clearAccountScopedState()
    return result
  })

  secureContractHandle(walletDeleteContract, async (password) => {
    const state = walletManager.getState()
    if (!state.isCreated && !state.decryptFailed) {
      ipcFailure('WALLET_NOT_FOUND', 'No wallet to delete')
    }
    if (!state.passwordProtected) {
      ipcFailure('WALLET_PASSWORD_REQUIRED', 'Set a wallet password before deleting the wallet')
    }
    const walletIdentity = walletManager.getIdentitySnapshot()
    if (!walletIdentity) ipcFailure('WALLET_DELETE_FAILED', 'Wallet identity is unavailable')
    try {
      await walletManager.authenticatePassword(password)
    } catch (error) {
      ipcFailure('INVALID_PASSWORD', 'Invalid wallet password', false, error)
    }
    if (!(await requestWalletDeletionApproval(overlayManager, state.address))) {
      ipcFailure('USER_CANCELLED', 'Wallet deletion cancelled')
    }
    paymentInterceptor.clearAccountState()
    let result: WalletState
    try {
      result = await walletManager.deleteWallet(password, walletIdentity)
    } catch (error) {
      if (error instanceof WalletDecryptionError) {
        ipcFailure('INVALID_PASSWORD', 'Invalid wallet password', false, error)
      }
      ipcFailure('WALLET_DELETE_FAILED', 'Unable to delete wallet', false, error)
    }
    await clearAccountScopedState()
    return result
  })

  secureContractHandle(walletForgetContract, async () => {
    const state = walletManager.getState()
    if (!state.isCreated && !state.decryptFailed) ipcFailure('WALLET_NOT_FOUND', 'No wallet to remove')
    const snapshot = await walletManager.getForgetSnapshot()
    if (!snapshot) ipcFailure('WALLET_NOT_FOUND', 'No wallet data to remove')
    if (!(await requestWalletForgetApproval(overlayManager, state.address))) {
      ipcFailure('USER_CANCELLED', 'Wallet removal cancelled')
    }
    paymentInterceptor.clearAccountState()
    let result: WalletState
    try {
      result = await walletManager.forgetWallet(snapshot.fingerprint)
    } catch (error) {
      ipcFailure('WALLET_FORGET_FAILED', 'Unable to remove wallet from this device', false, error)
    }
    await clearAccountScopedState()
    return result
  })

  secureContractHandle(walletExportMnemonicContract, async (password?: string) => {
    const state = walletManager.getState()
    if (!state.passwordProtected && process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
      try {
        await systemPreferences.promptTouchID('Show TON wallet recovery phrase')
      } catch (error) {
        ipcFailure('USER_CANCELLED', 'Recovery phrase export cancelled', false, error)
      }
    }
    try {
      return await walletManager.exportMnemonic(password)
    } catch (error) {
      ipcFailure('MNEMONIC_UNAVAILABLE', 'Mnemonic is unavailable', false, error)
    }
  })

  secureContractHandle(walletUnlockContract, async (password) => {
    if (!walletManager.getState().isCreated) ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    try {
      return await walletManager.unlock(password)
    } catch (error) {
      ipcFailure('INVALID_PASSWORD', 'Invalid wallet password', false, error)
    }
  })

  secureContractHandle(walletLockContract, () => {
    if (!walletManager.getState().isCreated) ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    return walletManager.lock()
  })

  secureContractHandle(walletSetupPasswordContract, async (password) => {
    if (!walletManager.getState().isCreated) ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    try {
      return await walletManager.setupPassword(password)
    } catch (error) {
      ipcFailure('WALLET_PASSWORD_SETUP_FAILED', 'Unable to protect the wallet', false, error)
    }
  })

  secureContractHandle(walletCreateBackupChallengeContract, async (password?: string) => {
    const state = walletManager.getState()
    if (!state.isCreated || !state.publicKey) ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    try {
      return await walletManager.createBackupChallenge(password)
    } catch (error) {
      ipcFailure('BACKUP_CHALLENGE_FAILED', 'Unable to create backup challenge', false, error)
    }
  })

  secureContractHandle(walletMarkBackupVerifiedContract, async (challengeId, password, answers) => {
    try {
      return await walletManager.verifyBackup(challengeId, password, answers)
    } catch (error) {
      ipcFailure('BACKUP_VERIFICATION_FAILED', 'Unable to verify wallet backup', false, error)
    }
  })

  secureContractHandle(walletChangePasswordContract, async (currentPassword, nextPassword) => {
    if (!walletManager.getState().isCreated) ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    try {
      return await walletManager.changePassword(currentPassword, nextPassword)
    } catch (error) {
      ipcFailure('WALLET_PASSWORD_CHANGE_FAILED', 'Unable to change wallet password', false, error)
    }
  })

  secureContractHandle(walletPageOpenContract, (open) => {
    try {
      walletManager.setPageOpen(open)
    } catch (error) {
      ipcFailure('WALLET_PAGE_STATE_FAILED', 'Unable to update wallet page state', false, error)
    }
    return { success: true as const }
  })

  secureContractHandle(walletSensitiveDisplayContract, (active) => {
    const window = getMainWindow()
    if (!window) ipcFailure('SENSITIVE_DISPLAY_FAILED', 'Main window unavailable')
    window.setContentProtection(active)
    return { success: true as const }
  })

  secureContractHandle(dnsResolveContract, async (domain) => {
    const normalizedDomain = domain.trim().toLowerCase()
    if (!isTonDomain(normalizedDomain)) ipcFailure('INVALID_DOMAIN', 'Invalid .ton domain')
    let result: DnsResolveResult
    try {
      result = await walletManager.resolveDomain(normalizedDomain)
    } catch (error) {
      if (toError(error).message === 'Bridge not connected') {
        ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
      }
      ipcFailure('DNS_RESOLUTION_FAILED', 'Unable to resolve domain', false, error)
    }

    // Enrich with storage bag ID if the proxy has already discovered it for this domain
    // (discovered via log parsing when serving .ton sites that use TON Storage).
    // This gives us the real bag ID from the contract/proxy without extra on-chain queries.
    if (result.has_storage && !result.storage_bag_id) {
      const knownBag = registry.tabManager.storage.storageBagCache.get(normalizedDomain)
      if (knownBag) {
        result.storage_bag_id = knownBag
      }
    }

    return result
  })

  log.debug('Wallet handlers registered')
}
