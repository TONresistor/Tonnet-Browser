/**
 * Lifecycle helpers shared between the IPC handlers and the withdraw driver.
 *
 * Both surfaces need to start the runner with the same config (loaded from
 * disk, not passed by the caller), so the spawn logic lives here as a single
 * helper instead of being duplicated.
 */

import { errorMessage } from '../../shared/errors'
import { loadCocoonWallet } from './wallet'
import type { CocoonManager } from './manager'
import { createLogger } from '../../shared/logger'

const log = createLogger('cocoon:lifecycle')

/** Mainnet CocoonRoot contract address — also referenced from the IPC handler. */
export const COCOON_ROOT_MAINNET = 'EQCns7bYSp0igFvS1wpb5wsZjCKCV19MD5AVzI4EyxsnU73k'

const AUTO_RETRY_DELAY_MS = 1_500

/**
 * Boot the cocoon manager from on-disk wallet state. Idempotent on already-
 * running ('ready' returns immediately, 'crashed' triggers a clean stop+start).
 *
 * Throws if no wallet has been generated, so callers can surface a clear
 * "complete setup first" error.
 */
export async function startCocoonManager(
  manager: CocoonManager,
  signal: AbortSignal = manager.getStartSignal()
): Promise<void> {
  signal.throwIfAborted()
  const state = manager.getState()
  if (state.kind === 'ready') return
  if (state.kind === 'starting') {
    throw new Error('Cocoon is already starting')
  }
  if (state.kind === 'crashed') {
    await manager.stop(signal)
    signal.throwIfAborted()
  }

  const wallet = await loadCocoonWallet()
  signal.throwIfAborted()
  if (!wallet) throw new Error('Cocoon wallet not initialized — complete setup first')

  const config = {
    ownerAddress: wallet.ownerAddress,
    nodeWalletKeyBase64: wallet.nodeSecretBase64,
    rootContractAddress: COCOON_ROOT_MAINNET,
  }

  try {
    await manager.start(config, signal)
    signal.throwIfAborted()
  } catch (err) {
    const message = errorMessage(err)
    if (!/^Process readiness timed out after \d+ms$/.test(message)) throw err
    signal.throwIfAborted()

    log.warn(`Cocoon did not become ready on first attempt (${message}); retrying once`)
    await new Promise<void>((resolve) => setTimeout(resolve, AUTO_RETRY_DELAY_MS))
    signal.throwIfAborted()
    await manager.start(config, signal)
    signal.throwIfAborted()
  }
}
