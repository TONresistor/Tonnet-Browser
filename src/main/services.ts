/**
 * Pure DI composition root.
 * Creates all service instances and wires dependencies via constructors.
 * IPC handlers and other consumers receive a ServiceRegistry instead of
 * importing module-level singletons.
 */

import { ElectronSafeStorageAdapter } from './adapters/electron-secure-storage'
import { ProxyManager } from './proxy/manager'
import { StorageManager } from './storage/daemon'
import { WalletManager } from './wallet/manager'
import { WalletHistoryManager } from './wallet/history'
import { PaymentInterceptor } from './wallet/payment-interceptor'
import { PaymentPolicyStore } from './wallet/payment-policy'
import { OverlayManager } from './windows/overlay-manager'
import { BridgePermissionInterceptor } from './bridge/permission-interceptor'
import { BridgePermissionStore } from './bridge/permission-store'
import { TonConnectService } from './tonconnect/service'
import { TonConnectSessionStore } from './tonconnect/session-store'
import { HistoryManager } from './history/manager'
import { ContentFilterManager } from './content-filter/filter-manager'
import { CocoonManager } from './cocoon/manager'
import { WithdrawDriver } from './cocoon/withdraw-driver'
import { RecoveryDriver } from './cocoon/recovery-driver'
import type { ISecureStorage } from './ports/secure-storage'

export interface ServiceRegistry {
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
  tonConnectService: TonConnectService
  tonConnectSessionStore: TonConnectSessionStore
  historyManager: HistoryManager
  contentFilterManager: ContentFilterManager
  cocoonManager: CocoonManager
  withdrawDriver: WithdrawDriver
  recoveryDriver: RecoveryDriver
}

export function createServices(): ServiceRegistry {
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
  const tonConnectSessionStore = new TonConnectSessionStore()
  const tonConnectService = new TonConnectService(walletManager, tonConnectSessionStore, overlayManager)
  const cocoonManager = new CocoonManager()
  const withdrawDriver = new WithdrawDriver(
    cocoonManager,
    () => walletManager.getBridgeClient(),
    () => walletManager.getState().address || null,
    async (nodeAddress, amountNano) => {
      await walletManager.send(nodeAddress, amountNano.toString())
    }
  )
  // React to runner state changes so refundable transitions are picked up
  // immediately instead of waiting the full 30s tick. start() is deferred to
  // the ws-bridge-ready handler since the driver needs the bridge to do work.
  cocoonManager.on('state-change', () => withdrawDriver.triggerTick())

  // Recovery driver runs in parallel for ARCHIVED wallets whose client SC
  // still locks user TON. start() is deferred to the ws-bridge-ready handler.
  const recoveryDriver = new RecoveryDriver(
    () => walletManager.getBridgeClient(),
    () => walletManager.getState().address || null
  )

  return {
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
    tonConnectService,
    tonConnectSessionStore,
    historyManager,
    contentFilterManager,
    cocoonManager,
    withdrawDriver,
    recoveryDriver,
  }
}

export async function destroyServices(registry: ServiceRegistry): Promise<void> {
  // Flush history before anything else (idempotent, safe if already called by before-quit)
  await registry.historyManager.onAppExit()

  registry.overlayManager.destroy()
  registry.bridgeInterceptor.destroy()
  registry.paymentInterceptor.destroy()
  await registry.paymentPolicyStore.destroy()
  await registry.proxyManager.stop()
  registry.storageManager.stop()
  registry.walletManager.destroy()
  registry.withdrawDriver.stop()
  registry.recoveryDriver.stop()
  await registry.cocoonManager.stop()
}
