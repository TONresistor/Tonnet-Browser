/**
 * IPC handlers for wallet operations.
 */

import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandle, log } from './shared'
import { walletManager } from '../../wallet/manager'
import { walletHistoryManager } from '../../wallet/history'
import { paymentInterceptor } from '../../wallet/payment-interceptor'

export function registerWalletHandlers(): void {
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

  secureHandle(IPC_CHANNELS.WALLET_EXPORT_MNEMONIC, async () => {
    return await walletManager.exportMnemonic()
  })

  secureHandle(IPC_CHANNELS.WALLET_RESOLVE_DOMAIN, async (domain: string) => {
    if (!domain || typeof domain !== 'string' || !domain.endsWith('.ton')) {
      throw new Error('Invalid .ton domain')
    }
    return await walletManager.resolveDomain(domain)
  })

  secureHandle(IPC_CHANNELS.WALLET_GET_NFTS, async () => {
    return await walletManager.fetchNfts()
  })

  secureHandle(IPC_CHANNELS.WALLET_GET_DOMAINS, async () => {
    return await walletManager.fetchDomains()
  })

  secureHandle(IPC_CHANNELS.WALLET_LOOKUP_DOMAIN, async (domain: string) => {
    if (!domain || typeof domain !== 'string' || !domain.endsWith('.ton')) {
      throw new Error('Invalid .ton domain')
    }
    return await walletManager.lookupDomain(domain)
  })

  log.info('Wallet handlers registered')
}
