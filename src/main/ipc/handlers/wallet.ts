/**
 * IPC handlers for wallet operations.
 */

import { IPC_CHANNELS, type WalletState, type WalletTransaction } from '../../../shared/types'
import { secureHandle, emitToRenderer, log } from './shared'
import { getMainWindow } from '../../windows/main'
import type { ServiceRegistry } from '../../services'

export function registerWalletHandlers(registry: ServiceRegistry): void {
  const { walletManager, walletHistoryManager, paymentInterceptor, overlayManager } = registry

  // Forward wallet events to renderer
  walletManager.on('balance-updated', (balance: string) => {
    emitToRenderer('wallet:balance-updated', balance)
  })

  walletManager.on('state-changed', (state: WalletState) => {
    emitToRenderer('wallet:state-changed', state)
  })

  walletManager.on('new-transaction', (tx: WalletTransaction) => {
    emitToRenderer('wallet:new-transaction', tx)
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

  secureHandle(IPC_CHANNELS.WALLET_SEND, async (to: string, amount: string) => {
    if (!to || typeof to !== 'string') {
      throw new Error('Invalid recipient address')
    }
    if (!amount || typeof amount !== 'string' || !/^\d+$/.test(amount)) {
      throw new Error('Invalid amount: must be a string of digits (nanoTON)')
    }
    const tx = await walletManager.send(to, amount)
    await walletHistoryManager.add(tx)
    return tx
  })

  secureHandle(IPC_CHANNELS.WALLET_GET_HISTORY, async (limit?: number) => {
    const safeLimit = typeof limit === 'number' && limit > 0 ? limit : 20
    const [onChain, local] = await Promise.all([
      walletManager.fetchOnChainHistory(safeLimit),
      walletHistoryManager.getRecent(100),
    ])
    return walletHistoryManager.merge(onChain, local)
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
