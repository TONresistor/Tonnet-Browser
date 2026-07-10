/**
 * IPC handlers for wallet operations.
 */

import type { WalletState, WalletTransaction } from '../../../shared/types'
import { toError, log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import { getMainWindow } from '../../windows/main'
import { WALLET_HISTORY_DEFAULT_LIMIT } from '../../wallet/constants'
import { fetchHistoryViaIndexer } from '../../wallet/indexer-client'
import { getSetting } from '../../settings'
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
  dnsResolveContract,
} from '../../../shared/ipc-contract/wallet'
import { ipcFailure, ownIpcEmitterListener, secureContractHandle, tonsiteContractHandle } from '../contract-handler'

export function registerWalletHandlers(registry: ServiceRegistry): void {
  const { walletManager, walletHistoryManager, paymentInterceptor, overlayManager, tonConnectService } = registry

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

  secureContractHandle(walletCreateContract, async () => {
    return await walletManager.create()
  })

  secureContractHandle(walletGetStateContract, () => {
    return walletManager.getState()
  })

  secureContractHandle(walletGetBalanceContract, async () => {
    return await walletManager.getBalance()
  })

  secureContractHandle(walletResolveRecipientContract, async (input) => {
    return await walletManager.resolveRecipient(input)
  })

  secureContractHandle(walletSendContract, async (to, amount, comment?: string) => {
    const resolved = await walletManager.resolveRecipient(to)
    // Balance check: prevent sending more than available
    const balance = await walletManager.getBalance()
    if (BigInt(amount) > BigInt(balance)) {
      throw new Error('Insufficient balance')
    }
    const tx = await walletManager.send(resolved.address, amount, comment)
    await walletHistoryManager.add(tx)
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
      throw toError(error)
    }
  })

  secureContractHandle(walletClearHistoryContract, async () => {
    await walletHistoryManager.clear()
    return { success: true as const }
  })

  secureContractHandle(walletExportKeyContract, () => {
    const state = walletManager.getState()
    if (!state.isCreated) {
      throw new Error('No wallet exists')
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

  tonsiteContractHandle(walletPayForXhrContract, async (_domain, event, payload) => {
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
  })

  secureContractHandle(walletImportContract, async (mnemonic) => {
    return await walletManager.importWallet(mnemonic)
  })

  secureContractHandle(walletDeleteContract, async () => {
    const state = walletManager.getState()
    if (!state.isCreated && !state.decryptFailed) {
      throw new Error('No wallet to delete')
    }
    const result = await walletManager.deleteWallet()
    await walletHistoryManager.clear()
    await tonConnectService.clearSessions()
    return result
  })

  secureContractHandle(walletExportMnemonicContract, async () => {
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

      overlayManager.show(
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
    })

    if (!confirmed) {
      throw new Error('Export cancelled by user')
    }
    return await walletManager.exportMnemonic()
  })

  secureContractHandle(dnsResolveContract, async (domain) => {
    const result = await walletManager.resolveDomain(domain)

    // Enrich with storage bag ID if the proxy has already discovered it for this domain
    // (discovered via log parsing when serving .ton sites that use TON Storage).
    // This gives us the real bag ID from the contract/proxy without extra on-chain queries.
    if (result.has_storage && !result.storage_bag_id) {
      const knownBag = registry.tabManager.storage.storageBagCache.get(domain.toLowerCase())
      if (knownBag) {
        result.storage_bag_id = knownBag
      }
    }

    return result
  })

  log.info('Wallet handlers registered')
}
