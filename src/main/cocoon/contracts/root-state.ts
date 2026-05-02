/**
 * Read the CocoonRoot contract state from mainnet (or a custom address).
 *
 * Uses the vendored CocoonRoot wrapper's getCurParams() getter which is
 * available via the bridge's runMethod infrastructure without needing raw
 * contract data access.
 */

import { Address } from '@ton/core'
import { createLogger } from '../../../shared/logger'
import { CocoonRoot } from './wrappers/CocoonRoot'
import { openBridgeContract } from './bridge-provider'
import type { WsBridgeClient } from '../../wallet/ws-bridge-client'

const log = createLogger('cocoon:root-state')

const COCOON_ROOT_MAINNET = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

export interface RootSnapshot {
  /** Registered proxy addresses (empty when enumeration is unavailable via the bridge). */
  proxies: string[]
  pricePerToken: bigint
  workerFeePerToken: bigint
  /** Prompt token price multiplier (basis points, 10000 = 1×). */
  promptMultiplier: number
  /** Completion token price multiplier (basis points). */
  completionMultiplier: number
  /** Cached token price multiplier (basis points). */
  cachedMultiplier: number
  /** Reasoning token price multiplier (basis points). */
  reasoningMultiplier: number
  minClientStake: bigint
  minProxyStake: bigint
  proxyDelayBeforeClose: number
  clientDelayBeforeClose: number
  isTest: boolean
}

/**
 * Fetch a flat snapshot of the root contract parameters.
 *
 * Calls `get_cur_params` via the bridge's runMethod. The `proxies` field is
 * returned as an empty array because iterating all registered proxies would
 * require N additional round-trips; callers that need proxy addresses should
 * use a dedicated lookup.
 */
export async function readRootSnapshot(
  bridge: WsBridgeClient,
  rootAddress: string = COCOON_ROOT_MAINNET
): Promise<RootSnapshot> {
  const root = CocoonRoot.createFromAddress(Address.parse(rootAddress))
  const opened = openBridgeContract(bridge, root)

  try {
    const params = await opened.getCurParams()

    const snapshot: RootSnapshot = {
      proxies: [],
      pricePerToken: params.pricePerToken,
      workerFeePerToken: params.workerFeePerToken,
      // get_cur_params does not expose prompt/completion multipliers (struct_version < 3)
      promptMultiplier: 10000,
      completionMultiplier: 10000,
      cachedMultiplier: params.cachedTokensPriceMultiplier,
      reasoningMultiplier: params.reasoningTokensPriceMultiplier,
      minClientStake: params.minClientStake,
      minProxyStake: params.minProxyStake,
      proxyDelayBeforeClose: params.proxyDelayBeforeClose,
      clientDelayBeforeClose: params.clientDelayBeforeClose,
      isTest: params.isTest !== 0,
    }

    log.debug(
      `Root snapshot: proxies=${snapshot.proxies.length} price=${snapshot.pricePerToken} isTest=${snapshot.isTest}`
    )
    return snapshot
  } catch (err) {
    log.error(`readRootSnapshot failed for ${rootAddress}:`, err)
    throw err
  }
}
