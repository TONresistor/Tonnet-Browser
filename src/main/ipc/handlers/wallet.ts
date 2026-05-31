/**
 * IPC handlers for wallet operations.
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import type { WalletState, WalletTransaction } from '../../../shared/types'
import { secureHandle, tonsiteHandle, emitToRenderer, payForXhrLimiter, toError, log } from './shared'
import { getMainWindow } from '../../windows/main'
import { WALLET_HISTORY_DEFAULT_LIMIT, WALLET_HISTORY_LOCAL_PREFETCH } from '../../wallet/constants'
import type { ServiceRegistry } from '../../services'

export function registerWalletHandlers(registry: ServiceRegistry): void {
  const { walletManager, walletHistoryManager, paymentInterceptor, overlayManager } = registry

  walletManager.on('balance-updated', (balance: string) => {
    emitToRenderer(IPC_CHANNELS.WALLET_BALANCE_UPDATED, balance)
  })

  walletManager.on('state-changed', (state: WalletState) => {
    emitToRenderer(IPC_CHANNELS.WALLET_STATE_CHANGED, state)
  })

  walletManager.on('new-transaction', (tx: WalletTransaction) => {
    emitToRenderer(IPC_CHANNELS.WALLET_NEW_TRANSACTION, tx)
  })

  secureHandle(IPC_CHANNELS.WALLET_CREATE, async () => {
    return await walletManager.create()
  })

  secureHandle(IPC_CHANNELS.WALLET_GET_STATE, () => {
    return walletManager.getState()
  })

  secureHandle(IPC_CHANNELS.WALLET_GET_BALANCE, async () => {
    return await walletManager.getBalance()
  })

  secureHandle(IPC_CHANNELS.WALLET_RESOLVE_RECIPIENT, async (input: string) => {
    if (!input || typeof input !== 'string') {
      throw new Error('Invalid input')
    }
    return await walletManager.resolveRecipient(input)
  })

  secureHandle(IPC_CHANNELS.WALLET_SEND, async (to: string, amount: string) => {
    if (!to || typeof to !== 'string') {
      throw new Error('Invalid recipient address')
    }
    if (!amount || typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      throw new Error('Invalid amount: must be a string of digits (nanoTON)')
    }
    const resolved = await walletManager.resolveRecipient(to)
    // Balance check: prevent sending more than available
    const balance = await walletManager.getBalance()
    if (BigInt(amount) > BigInt(balance)) {
      throw new Error('Insufficient balance')
    }
    const tx = await walletManager.send(resolved.address, amount)
    await walletHistoryManager.add(tx)
    return tx
  })

  secureHandle(IPC_CHANNELS.WALLET_GET_HISTORY, async (limit?: number) => {
    const safeLimit = typeof limit === 'number' && limit > 0 ? limit : WALLET_HISTORY_DEFAULT_LIMIT
    const [onChainResult, localResult] = await Promise.allSettled([
      walletManager.fetchOnChainHistory(safeLimit),
      walletHistoryManager.getRecent(WALLET_HISTORY_LOCAL_PREFETCH),
    ])
    const local = localResult.status === 'fulfilled' ? localResult.value : []
    if (onChainResult.status === 'fulfilled') {
      return walletHistoryManager.merge(onChainResult.value, local)
    }
    // On-chain fetch failed: serve local pending tx if any, otherwise
    // propagate so the renderer preserves its existing list.
    if (local.length > 0) {
      log.warn('On-chain history fetch failed, serving local cache only')
      return local
    }
    throw toError(onChainResult.reason)
  })

  secureHandle(IPC_CHANNELS.WALLET_CLEAR_HISTORY, async () => {
    await walletHistoryManager.clear()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.WALLET_EXPORT_KEY, () => {
    const state = walletManager.getState()
    if (!state.isCreated) {
      throw new Error('No wallet exists')
    }
    // SECURITY: Only return public key, NEVER private key
    return { publicKey: state.publicKey, address: state.address, addressRaw: state.addressRaw }
  })

  secureHandle(IPC_CHANNELS.WALLET_APPROVE_PAYMENT, async (paymentId: string) => {
    if (!paymentId || typeof paymentId !== 'string') {
      throw new Error('Invalid payment ID')
    }
    await paymentInterceptor.approvePayment(paymentId)
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.WALLET_REJECT_PAYMENT, (paymentId: string) => {
    if (!paymentId || typeof paymentId !== 'string') {
      throw new Error('Invalid payment ID')
    }
    paymentInterceptor.rejectPayment(paymentId)
    return { success: true }
  })

  tonsiteHandle(IPC_CHANNELS.WALLET_PAY_FOR_XHR, async (_domain, event, payload: unknown) => {
    if (!payForXhrLimiter.check()) {
      return { success: false, error: 'rate-limit' }
    }
    if (!payload || typeof payload !== 'object') {
      return { success: false, error: 'invalid-url' }
    }
    const { url } = payload as { url: unknown }
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'invalid-url' }
    }
    const sender = event.sender
    try {
      const reqOrigin = new URL(url).origin
      const pageOrigin = new URL(sender.getURL()).origin
      if (reqOrigin !== pageOrigin) {
        return { success: false, error: 'cross-origin' }
      }
      log.debug(`pay-for-xhr origin: ${reqOrigin}`)
    } catch {
      return { success: false, error: 'invalid-url' }
    }
    return await paymentInterceptor.requestXhrPayment(sender.id, url)
  })

  secureHandle(IPC_CHANNELS.WALLET_IMPORT, async (mnemonic: string[]) => {
    if (!Array.isArray(mnemonic) || mnemonic.length !== 24) {
      throw new Error('Invalid mnemonic: must be 24 words')
    }
    return await walletManager.importWallet(mnemonic)
  })

  secureHandle(IPC_CHANNELS.WALLET_DELETE, async () => {
    const state = walletManager.getState()
    if (!state.isCreated && !state.decryptFailed) {
      throw new Error('No wallet to delete')
    }
    return await walletManager.deleteWallet()
  })

  secureHandle(IPC_CHANNELS.WALLET_EXPORT_MNEMONIC, async () => {
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

  secureHandle(IPC_CHANNELS.DNS_RESOLVE, async (domain: string) => {
    if (!domain || typeof domain !== 'string') {
      throw new Error('Invalid domain')
    }
    return await walletManager.resolveDomain(domain)
  })

  log.info('Wallet handlers registered')
}
