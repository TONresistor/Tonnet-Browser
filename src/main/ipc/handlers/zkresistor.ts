import { Address } from '@ton/core'
import type { ServiceRegistry } from '../../services'
import { getSetting } from '../../settings'
import { TonIndexerDisabledError } from '../../indexer/client'
import {
  zkResistorAccountContract,
  zkResistorCatalogContract,
  zkResistorMerkleContract,
  zkResistorResourceContract,
  zkResistorResourceStatusContract,
  zkResistorPrepareResourcesContract,
  zkResistorSendContract,
} from '../../../shared/ipc-contract/zkresistor'
import type { ZkResistorCatalogService } from '../../zkresistor/catalog-service'
import { getZkResistorResources, loadZkResistorResource } from '../../zkresistor/resources'
import type { ZkResistorStateService } from '../../zkresistor/state-service'
import type { validateZkResistorTransaction } from '../../zkresistor/transaction'
import { requestZkResistorApproval } from '../../wallet/wallet-approval'
import { ipcFailure, secureContractHandle } from '../contract-handler'

export function registerZkResistorHandlers(registry: ServiceRegistry): void {
  let activeState: {
    bridge: NonNullable<ReturnType<typeof registry.tonBridgeProviders.zkResistor.getBridge>>
    service: ZkResistorStateService
  } | null = null

  secureContractHandle(zkResistorResourceStatusContract, async () => {
    assertEnabled()
    return getZkResistorResources().status()
  })
  secureContractHandle(zkResistorPrepareResourcesContract, async () => {
    assertEnabled()
    return getZkResistorResources().prepare()
  })

  const stateService = async () => {
    const bridge = registry.tonBridgeProviders.zkResistor.getBridge()
    if (!bridge) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
    if (!activeState || activeState.bridge !== bridge) {
      const { ZkResistorStateService } = await import('../../zkresistor/state-service')
      if (!activeState || activeState.bridge !== bridge) {
        activeState = { bridge, service: new ZkResistorStateService(bridge, registry.tonIndexerClient) }
      }
    }
    return activeState.service
  }

  secureContractHandle(zkResistorCatalogContract, async () => {
    assertEnabled()
    const bridge = registry.tonBridgeProviders.zkResistor.getBridge()
    if (!bridge) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
    try {
      const { ZkResistorCatalogService } = await import('../../zkresistor/catalog-service')
      return await new ZkResistorCatalogService(bridge).load()
    } catch (error) {
      ipcFailure('ZKRESISTOR_CATALOG_FAILED', 'Unable to load the ZKResistor contracts', true, error)
    }
  })

  secureContractHandle(zkResistorAccountContract, async (poolAddress) => {
    assertEnabled()
    assertPoolAddress(poolAddress)
    try {
      return await (await stateService()).accountState(poolAddress)
    } catch (error) {
      if (isUnregisteredPool(error)) {
        ipcFailure('INVALID_ZKRESISTOR_POOL', 'Pool is not registered by the pinned Factory', false, error)
      }
      ipcFailure('ZKRESISTOR_STATE_FAILED', 'Unable to read the ZKResistor Pool', true, error)
    }
  })

  secureContractHandle(zkResistorMerkleContract, async (request) => {
    assertEnabled()
    assertResourcesReady()
    assertPoolAddress(request.poolAddress)
    try {
      return await (await stateService()).merkle(request)
    } catch (error) {
      if (isUnregisteredPool(error)) {
        ipcFailure('INVALID_ZKRESISTOR_POOL', 'Pool is not registered by the pinned Factory', false, error)
      }
      if (error instanceof TonIndexerDisabledError) {
        ipcFailure('ZKRESISTOR_INDEXER_REQUIRED', 'Enable the HTTP indexer in Settings > Wallet to use ZKResistor')
      }
      const { ZkResistorSyncIncompleteError } = await import('../../zkresistor/state-service')
      if (error instanceof ZkResistorSyncIncompleteError) {
        ipcFailure('ZKRESISTOR_STATE_FAILED', error.message, true, error)
      }
      ipcFailure('ZKRESISTOR_STATE_FAILED', 'Unable to verify the local ZKResistor state', true, error)
    }
  })

  secureContractHandle(zkResistorResourceContract, async (resource) => {
    assertEnabled()
    try {
      return { base64: (await loadZkResistorResource(resource.name)).toString('base64') }
    } catch (error) {
      ipcFailure('ZKRESISTOR_RESOURCE_FAILED', 'Unable to load a verified ZKResistor resource', true, error)
    }
  })

  secureContractHandle(zkResistorSendContract, async (request) => {
    assertEnabled()
    assertResourcesReady()
    const { walletManager, tonBridgeProviders, overlayManager } = registry
    const state = walletManager.getState()
    if (!state.isCreated) ipcFailure('WALLET_UNAVAILABLE', 'Wallet is not initialized')
    if (state.needsPasswordSetup) ipcFailure('WALLET_PASSWORD_REQUIRED', 'Set a wallet password before sending')
    if (state.isLocked) ipcFailure('WALLET_LOCKED', 'Unlock the wallet before sending')
    if (!state.backupVerified) ipcFailure('WALLET_BACKUP_REQUIRED', 'Verify the wallet backup before sending')
    const bridge = tonBridgeProviders.zkResistor.getBridge()
    if (!bridge) ipcFailure('BRIDGE_DISCONNECTED', 'Bridge not connected')
    const walletIdentity = walletManager.getIdentitySnapshot()
    if (!walletIdentity) ipcFailure('WALLET_UNAVAILABLE', 'Wallet identity is unavailable')

    let pool: Awaited<ReturnType<ZkResistorCatalogService['load']>>['pools'][number]
    let transaction: ReturnType<typeof validateZkResistorTransaction>
    try {
      const [{ ZkResistorCatalogService }, { validateZkResistorTransaction }] = await Promise.all([
        import('../../zkresistor/catalog-service'),
        import('../../zkresistor/transaction'),
      ])
      const catalog = await new ZkResistorCatalogService(bridge).load()
      const requestedAddress = Address.parse(request.poolAddress)
      const registered = catalog.pools.find((candidate) => Address.parse(candidate.address).equals(requestedAddress))
      if (!registered) throw new Error('Pool is not registered by the pinned Factory')
      pool = registered
      transaction = validateZkResistorTransaction(request, pool, state.addressRaw)
    } catch (error) {
      ipcFailure('INVALID_ZKRESISTOR_TRANSACTION', 'Invalid ZKResistor transaction', false, error)
    }

    let preflight: Awaited<ReturnType<typeof walletManager.preflightContractMessage>>
    try {
      preflight = await walletManager.preflightContractMessage(
        pool.address,
        request.value,
        transaction.body,
        walletIdentity
      )
    } catch (error) {
      ipcFailure('TRANSFER_PREFLIGHT_FAILED', 'Unable to verify the ZKResistor transaction', true, error)
    }
    if (BigInt(request.value) + BigInt(preflight.estimatedFee) > BigInt(preflight.walletBalance)) {
      ipcFailure('INSUFFICIENT_BALANCE', 'Insufficient wallet balance')
    }

    const poolAddress = Address.parse(pool.address).toString({ bounceable: true, urlSafe: true })
    const approved = await requestZkResistorApproval(overlayManager, {
      operation: request.operation,
      poolAddress,
      denomination: pool.denomination,
      transactionValue: request.value,
      ...(transaction.recipient ? { recipient: transaction.recipient } : {}),
      estimatedFee: preflight.estimatedFee,
    })
    if (!approved) ipcFailure('USER_CANCELLED', 'ZKResistor transaction cancelled')
    assertEnabled()

    try {
      const boc = await walletManager.signTonConnectTransaction(
        [{ address: poolAddress, amount: request.value, payload: transaction.body.toBoc().toString('base64') }],
        state.addressRaw
      )
      return { boc }
    } catch (error) {
      ipcFailure('SIGNING_FAILED', 'Unable to sign or send the ZKResistor transaction', false, error)
    }
  })
}

function assertPoolAddress(value: string): void {
  try {
    Address.parse(value)
  } catch (error) {
    ipcFailure('INVALID_ZKRESISTOR_POOL', 'Invalid ZKResistor Pool address', false, error)
  }
}

function isUnregisteredPool(error: unknown): boolean {
  return error instanceof Error && error.message.includes('not registered by the pinned Factory')
}

function assertEnabled(): void {
  if (!getSetting('advanced').zkResistorEnabled) {
    ipcFailure('FEATURE_DISABLED', 'Enable ZKResistor in Settings > Advanced > Experimental features')
  }
}

function assertResourcesReady(): void {
  if (getZkResistorResources().status().status !== 'ready') {
    ipcFailure('ZKRESISTOR_RESOURCES_NOT_READY', 'Download and verify ZKR resources before using private actions')
  }
}
