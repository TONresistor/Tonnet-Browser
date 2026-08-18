/**
 * IPC handlers for wallet operations.
 */

import type { DnsResolveResult, WalletState, WalletTransaction } from '../../../shared/types'
import { toError, log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import { getMainWindow } from '../../windows/main'
import { WALLET_HISTORY_DEFAULT_LIMIT } from '../../wallet/constants'
import { fetchHistoryViaIndexer } from '../../wallet/indexer-client'
import { getSetting } from '../../settings'
import { isTonDomain } from '../../../shared/utils/ton'
import type { ServiceRegistry } from '../../services'
import {
  walletBalanceUpdatedContract,
  walletGetStateContract,
  walletNewTransactionContract,
  walletStateChangedContract,
  walletApprovePaymentContract,
  walletClearHistoryContract,
  walletCreateContract,
  walletDeleteContract,
  walletExportKeyContract,
  walletExportMnemonicContract,
  walletGetBalanceContract,
  walletGetHistoryContract,
  walletImportContract,
  walletPayForXhrContract,
  walletRejectPaymentContract,
  walletResolveRecipientContract,
  walletSendContract,
  walletUnlockContract,
  walletLockContract,
  walletSetupPasswordContract,
  walletMarkBackupVerifiedContract,
  dnsResolveContract,
} from '../../../shared/ipc-contract/wallet'
import { ipcFailure, ownIpcEmitterListener, secureContractHandle, tonsiteContractHandle } from '../contract-handler'
import { requestWalletTransferApproval } from '../../wallet/wallet-approval'

export function registerWalletHandlers(registry: ServiceRegistry): void {
  const { walletManager, walletHistoryManager, paymentInterceptor, overlayManager, tonConnectService } = registry
  const clearAccountScopedState = async (): Promise<void> => {
    const results = await Promise.allSettled([walletHistoryManager.clear(), tonConnectService.clearSessions()])
    for (const result of results) {
      if (result.status === 'rejected') {
        log.warn(`Failed to clear account-scoped state: ${toError(result.reason).message}`)
      }
    }
  }

  ownIpcEmitterListener(walletManager, 'balance-updated', (balance: string) => {
    emitContractToRenderer(walletBalanceUpdatedContract, balance)
  })

  ownIpcEmitterListener(walletManager, 'state-changed', (state: WalletState) => {
    emitContractToRenderer(walletStateChangedContract, state)
  })

  ownIpcEmitterListener(walletManager, 'new-transaction', (tx: WalletTransaction) => {
    emitContractToRenderer(walletNewTransactionContract, tx)
    void walletHistoryManager.reconcile([tx]).catch((err) => {
      log.warn(`Failed to cache live transaction: ${toError(err).message}`)
    })
  })

  secureContractHandle(walletCreateContract, async (password) => {
    if (walletManager.getState().isCreated) ipcFailure('WALLET_ALREADY_EXISTS', 'Wallet already exists')
    try {
      return await walletManager.create(password)
    } catch (error) {
      if (toError(error).message === 'Wallet already exists') {
        ipcFailure('WALLET_ALREADY_EXISTS', 'Wallet already exists', false, error)
      }
      ipcFailure('WALLET_CREATE_FAILED', 'Unable to create wallet', false, error)
    }
  })

  secureContractHandle(walletGetStateContract, () => {
    return walletManager.getState()
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

  secureContractHandle(walletSendContract, async (to, amount, comment?: string) => {
    const state = walletManager.getState()
    if (!state.isCreated) ipcFailure('WALLET_UNAVAILABLE', 'Wallet is not initialized')
    if (state.needsPasswordSetup) ipcFailure('WALLET_PASSWORD_REQUIRED', 'Set a wallet password before sending')
    if (state.isLocked) ipcFailure('WALLET_LOCKED', 'Unlock the wallet before sending')
    if (!state.backupVerified) ipcFailure('WALLET_BACKUP_REQUIRED', 'Verify the wallet backup before sending')
    if (!walletManager.getTonBridge()) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
    if (BigInt(amount) <= 0n) ipcFailure('INVALID_AMOUNT', 'Amount must be greater than zero')
    let resolved: { address: string; domain?: string }
    try {
      resolved = await walletManager.resolveRecipient(to)
    } catch (error) {
      const domainFailure = isTonDomain(to)
      ipcFailure(
        domainFailure ? 'DNS_RESOLUTION_FAILED' : 'INVALID_RECIPIENT',
        domainFailure ? 'Unable to resolve recipient domain' : 'Invalid recipient',
        false,
        domainFailure ? error : undefined
      )
    }
    let balance: string
    try {
      balance = await walletManager.getBalance()
    } catch (error) {
      ipcFailure('BALANCE_READ_FAILED', 'Unable to read wallet balance', true, error)
    }
    if (BigInt(amount) > BigInt(balance)) {
      ipcFailure('INSUFFICIENT_BALANCE', 'Insufficient balance')
    }
    const approved = await requestWalletTransferApproval(overlayManager, {
      address: resolved.address,
      amount,
      domain: resolved.domain,
      comment,
    })
    if (!approved) ipcFailure('USER_CANCELLED', 'Transfer cancelled')
    let tx: WalletTransaction
    try {
      tx = await walletManager.send(resolved.address, amount, comment)
    } catch (error) {
      ipcFailure('SIGNING_FAILED', 'Unable to sign or send transaction', false, error)
    }
    try {
      await walletHistoryManager.add(tx)
    } catch (error) {
      log.warn(`Transaction sent but history persistence failed: ${toError(error).message}`)
    }
    return tx
  })

  secureContractHandle(walletGetHistoryContract, async (limit?: number) => {
    const safeLimit = typeof limit === 'number' && limit > 0 ? limit : WALLET_HISTORY_DEFAULT_LIMIT
    try {
      const onChain = await walletManager.fetchOnChainHistory(safeLimit)
      return await walletHistoryManager.reconcile(onChain)
    } catch (error) {
      const walletSettings = getSetting('wallet')
      if (walletSettings.indexerEnabled) {
        try {
          const address = walletManager.getState().address
          const viaIndexer = await fetchHistoryViaIndexer(
            address,
            safeLimit,
            walletSettings.indexerEndpoint,
            walletSettings.indexerApiKey
          )
          if (viaIndexer.length > 0) {
            return await walletHistoryManager.reconcile(viaIndexer)
          }
        } catch (indexerError) {
          log.warn(`Indexer history fetch failed: ${toError(indexerError).message}`)
        }
      }
      const cached = await walletHistoryManager.getAll()
      if (cached.length > 0) {
        log.warn(`On-chain history fetch failed, serving cached history: ${toError(error).message}`)
        return cached
      }
      ipcFailure('WALLET_HISTORY_FAILED', 'Unable to load wallet history', false, error)
    }
  })

  secureContractHandle(walletClearHistoryContract, async () => {
    try {
      await walletHistoryManager.clear()
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

  secureContractHandle(walletImportContract, async (mnemonic, password) => {
    let result: WalletState
    try {
      result = await walletManager.importWallet(mnemonic, password)
    } catch (error) {
      const code = toError(error).message === 'Invalid mnemonic phrase' ? 'INVALID_MNEMONIC' : 'WALLET_IMPORT_FAILED'
      ipcFailure(
        code,
        code === 'INVALID_MNEMONIC' ? 'Invalid mnemonic phrase' : 'Unable to import wallet',
        false,
        code === 'INVALID_MNEMONIC' ? undefined : error
      )
    }
    await clearAccountScopedState()
    return result
  })

  secureContractHandle(walletDeleteContract, async () => {
    const state = walletManager.getState()
    if (!state.isCreated && !state.decryptFailed) {
      ipcFailure('WALLET_NOT_FOUND', 'No wallet to delete')
    }
    let result: WalletState
    try {
      result = await walletManager.deleteWallet()
    } catch (error) {
      ipcFailure('WALLET_DELETE_FAILED', 'Unable to delete wallet', false, error)
    }
    await clearAccountScopedState()
    return result
  })

  secureContractHandle(walletExportMnemonicContract, async (password) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      const win = getMainWindow()
      if (!win) {
        resolve(false)
        return
      }

      const bounds = win.getContentBounds()
      const w = 420
      const h = 260
      const x = Math.round(bounds.width / 2 - w / 2)
      const y = Math.round(bounds.height / 3)
      const overlayId = 'wallet-export-confirm'

      const shown = overlayManager.show(
        overlayId,
        { x, y, width: w, height: h },
        {
          type: 'form',
          title: 'Export Seed Phrase',
          fields: [
            {
              id: '_warning',
              label: 'Your 24-word seed phrase will be displayed.',
              value:
                'Anyone who sees these words can take full control of your wallet. Only proceed if you are in a safe environment.',
              readonly: true,
            },
          ],
          actions: [
            { id: 'cancel', label: 'Cancel' },
            { id: 'show', label: 'Show Seed Phrase', primary: true },
          ],
        },
        (actionType) => {
          overlayManager.hide(overlayId)
          resolve(actionType === 'show')
        }
      )
      if (!shown) resolve(false)
    })

    if (!confirmed) {
      ipcFailure('USER_CANCELLED', 'Export cancelled')
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

  secureContractHandle(walletMarkBackupVerifiedContract, async () => {
    if (!walletManager.getState().isCreated) ipcFailure('WALLET_NOT_FOUND', 'No wallet exists')
    try {
      return await walletManager.markBackupVerified()
    } catch (error) {
      ipcFailure('BACKUP_VERIFICATION_FAILED', 'Unable to verify wallet backup', false, error)
    }
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
