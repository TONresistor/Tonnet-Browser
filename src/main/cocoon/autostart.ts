/**
 * Cocoon runner boot autostart. Extracted from index.ts (OPP-65).
 */
import log from '../../shared/logger'
import { getSetting } from '../settings'
import { loadCocoonWallet } from './wallet'
import { COCOON_ROOT_MAINNET } from './lifecycle'
import type { ServiceRegistry } from '../services'

/**
 * Start the Cocoon runner at boot if the user has opted in via settings AND
 * the wallet has finished setup. Fired after the WS bridge becomes ready,
 * so the runner sees a connected proxy/bridge/storage stack.
 */
export async function autostartCocoonIfEnabled(services: ServiceRegistry): Promise<void> {
  const { autostart } = getSetting('cocoon')
  if (!autostart) return
  const data = await loadCocoonWallet()
  // Only auto-start when the user has already completed the setup wizard.
  if (!data || data.setupCompletedAt == null) {
    log.info('Cocoon autostart skipped (no completed wallet)')
    return
  }
  log.info('Cocoon autostart: launching runner...')
  try {
    await services.cocoonManager.start({
      ownerAddress: data.ownerAddress,
      nodeWalletKeyBase64: data.nodeSecretBase64,
      rootContractAddress: COCOON_ROOT_MAINNET,
    })
  } catch (err) {
    log.error('Cocoon autostart failed:', err)
  }
}
