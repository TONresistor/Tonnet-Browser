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
import { emitContractToRenderer } from './events/renderer-events'
import type { CocoonActivationPorts } from './cocoon/activation'
import { TabManager } from './windows/tabs'
import { ChatSessionController, type ChatRuntimeSession } from './chat/session-controller'
import { ConsumedArchive } from './cocoon/consumed-archive'
import { RecoveryQueueStore } from './cocoon/recovery-queue'
import { StakeCacheStore } from './cocoon/stake-cache'
import type { CocoonPersistence } from './cocoon/persistence'
import { TonConnectManifestLoader } from './tonconnect/manifest-loader'
import { ElectronTonConnectApproval } from './tonconnect/electron-approval'
import { ElectronTonConnectEventDelivery } from './tonconnect/electron-event-delivery'
import {
  walletPaymentFailedContract,
  walletPaymentMadeContract,
  walletPaymentRequestedContract,
} from '../shared/ipc-contract/wallet'
import { DisposableStore, onEmitter } from './utils/disposable'

export interface ServiceRegistry {
  ipcRegistrations: DisposableStore
  lifecycleRegistrations: DisposableStore
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
  cocoonActivation: CocoonActivationPorts
  tabManager: TabManager
  chatSessionController: ChatSessionController<ChatRuntimeSession>
  cocoonPersistence: CocoonPersistence
}

export function createServices(): ServiceRegistry {
  const ipcRegistrations = new DisposableStore()
  const lifecycleRegistrations = new DisposableStore()
  const secureStorage = new ElectronSafeStorageAdapter()

  // Create all services -- NO async init here, just construction
  const proxyManager = new ProxyManager()
  const storageManager = new StorageManager()
  const overlayManager = new OverlayManager()
  const tabManager = new TabManager()
  const chatSessionController = new ChatSessionController<ChatRuntimeSession>()
  const cocoonPersistence: CocoonPersistence = {
    consumedArchive: new ConsumedArchive(undefined, secureStorage),
    recoveryQueue: new RecoveryQueueStore(undefined, secureStorage),
    stakeCache: new StakeCacheStore(),
  }
  const historyManager = new HistoryManager()
  const contentFilterManager = new ContentFilterManager()
  const bridgePermissionStore = new BridgePermissionStore()
  const walletHistoryManager = new WalletHistoryManager()
  const paymentPolicyStore = new PaymentPolicyStore()
  const walletManager = new WalletManager(secureStorage)
  const paymentInterceptor = new PaymentInterceptor(
    walletManager,
    paymentPolicyStore,
    walletHistoryManager,
    (notification) => {
      const contract =
        notification.status === 'pending'
          ? walletPaymentRequestedContract
          : notification.status === 'completed'
            ? walletPaymentMadeContract
            : walletPaymentFailedContract
      emitContractToRenderer(contract, notification)
    }
  )
  const bridgeInterceptor = new BridgePermissionInterceptor(bridgePermissionStore, overlayManager)
  const tonConnectSessionStore = new TonConnectSessionStore()
  const tonConnectService = new TonConnectService(
    walletManager,
    tonConnectSessionStore,
    new ElectronTonConnectApproval(overlayManager),
    new TonConnectManifestLoader(),
    new ElectronTonConnectEventDelivery()
  )
  const cocoonManager = new CocoonManager()
  const withdrawDriver = new WithdrawDriver(
    cocoonManager,
    () => walletManager.getTonBridge(),
    () => walletManager.getState().address || null,
    cocoonPersistence,
    async (nodeAddress, amountNano) => {
      await walletManager.send(nodeAddress, amountNano.toString())
    }
  )
  // React to runner state changes so refundable transitions are picked up
  // immediately instead of waiting the full 30s tick. start() is deferred to
  // the ws-bridge-ready handler since the driver needs the bridge to do work.
  lifecycleRegistrations.add(onEmitter(cocoonManager, 'state-change', () => withdrawDriver.triggerTick()))

  // Recovery driver runs in parallel for ARCHIVED wallets whose client SC
  // still locks user TON. start() is deferred to the ws-bridge-ready handler.
  const recoveryDriver = new RecoveryDriver(
    () => walletManager.getTonBridge(),
    () => walletManager.getState().address || null,
    cocoonPersistence.recoveryQueue,
    cocoonPersistence.consumedArchive
  )
  const cocoonActivation: CocoonActivationPorts = {
    cocoonManager,
    getBridge: () => walletManager.getTonBridge(),
    getNativeAddress: () => walletManager.getState().address || null,
    getNativeBalance: () => walletManager.getBalance(),
    sendNative: (to, amount) => walletManager.send(to, amount),
    persistence: cocoonPersistence,
  }

  return {
    ipcRegistrations,
    lifecycleRegistrations,
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
    cocoonActivation,
    tabManager,
    chatSessionController,
    cocoonPersistence,
  }
}

export async function destroyServices(registry: ServiceRegistry): Promise<void> {
  registry.ipcRegistrations.dispose()
  registry.lifecycleRegistrations.dispose()
  // Flush history before anything else (idempotent, safe if already called by before-quit)
  await registry.historyManager.onAppExit()

  registry.tabManager.dispose()
  await registry.chatSessionController.disconnect()

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
