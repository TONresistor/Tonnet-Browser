/**
 * Pure DI composition root.
 * Creates all service instances and wires dependencies via constructors.
 * IPC handlers and other consumers receive a ServiceRegistry instead of
 * importing module-level singletons.
 */

import { ElectronSafeStorageAdapter } from './adapters/electron-secure-storage'
import { ElectronPathProvider } from './adapters/electron-path-provider'
import { ProxyManager } from './proxy/manager'
import { StorageManager } from './storage/daemon'
import { WalletManager } from './wallet/manager'
import { WalletHistoryManager } from './wallet/history'
import { PaymentInterceptor } from './wallet/payment-interceptor'
import { PaymentPolicyStore } from './wallet/payment-policy'
import { OverlayManager } from './windows/overlay-manager'
import { BridgePermissionInterceptor } from './bridge/permission-interceptor'
import { BridgePermissionStore } from './bridge/permission-store'
import { HistoryManager } from './history/manager'
import { ContentFilterManager } from './content-filter/filter-manager'
import type { IPathProvider } from './ports/path-provider'
import type { ISecureStorage } from './ports/secure-storage'

export interface ServiceRegistry {
  pathProvider: IPathProvider
  secureStorage: ISecureStorage
  proxyManager: ProxyManager
  storageManager: StorageManager
  walletManager: WalletManager
  walletHistoryManager: WalletHistoryManager
  paymentInterceptor: PaymentInterceptor
  paymentPolicyStore: PaymentPolicyStore
  overlayManager: OverlayManager
  bridgeInterceptor: BridgePermissionInterceptor
  bridgePermissionStore: BridgePermissionStore
  historyManager: HistoryManager
  contentFilterManager: ContentFilterManager
}

export function createServices(): ServiceRegistry {
  const pathProvider = new ElectronPathProvider()
  const secureStorage = new ElectronSafeStorageAdapter()

  // Create all services -- NO async init here, just construction
  const proxyManager = new ProxyManager()
  const storageManager = new StorageManager()
  const overlayManager = new OverlayManager()
  const historyManager = new HistoryManager()
  const contentFilterManager = new ContentFilterManager()
  const bridgePermissionStore = new BridgePermissionStore()
  const walletHistoryManager = new WalletHistoryManager()
  const paymentPolicyStore = new PaymentPolicyStore()
  const walletManager = new WalletManager(secureStorage)
  const paymentInterceptor = new PaymentInterceptor(walletManager, paymentPolicyStore, walletHistoryManager)
  const bridgeInterceptor = new BridgePermissionInterceptor(bridgePermissionStore, overlayManager)

  return {
    pathProvider,
    secureStorage,
    proxyManager,
    storageManager,
    walletManager,
    walletHistoryManager,
    paymentInterceptor,
    paymentPolicyStore,
    overlayManager,
    bridgeInterceptor,
    bridgePermissionStore,
    historyManager,
    contentFilterManager,
  }
}

export async function destroyServices(registry: ServiceRegistry): Promise<void> {
  registry.overlayManager.destroy()
  registry.bridgeInterceptor.destroy()
  registry.paymentPolicyStore.destroy()
  await registry.proxyManager.stop()
  registry.storageManager.stop()
  registry.walletManager.destroy()
}
