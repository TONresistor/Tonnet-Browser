/**
 * Retire the current Cocoon identity after its client SC is terminal.
 *
 * A cocoon_node identity should be treated as one stake-cycle only. Once the
 * client contract is closed and residual balances have been swept, the active
 * wallet must be removed so the next Activate creates a fresh node identity.
 */

import { errorMessage } from '../../shared/errors'
import { createLogger } from '../../shared/logger'
import { getConsumedArchive } from './consumed-archive'
import { getStakeCacheStore } from './stake-cache'
import { deleteCocoonWallet, loadCocoonWallet } from './wallet'

const log = createLogger('cocoon:retire-wallet')

export async function retireCurrentCocoonWallet(reason: string): Promise<boolean> {
  const wallet = await loadCocoonWallet()
  if (!wallet) return false

  const cache = await getStakeCacheStore().load()
  const archivedAt = Date.now()

  try {
    await getConsumedArchive().archive({
      archivedAt,
      ownerAddress: wallet.ownerAddress,
      nodeAddress: wallet.nodeAddress,
      ownerMnemonic: wallet.ownerMnemonic,
      nodeSecretBase64: wallet.nodeSecretBase64,
      nodePublicKeyHex: wallet.nodePublicKeyHex,
      lastClientSCAddress: cache?.clientSCAddress ?? null,
    })
  } catch (err) {
    // Terminal withdraw already recovered the funds. Do not keep the user
    // blocked from the next stake cycle just because historical archival failed.
    log.warn(`Retiring without archive (${reason}): ${errorMessage(err)}`)
  }

  await deleteCocoonWallet()
  await getStakeCacheStore().clear()
  log.info(`Retired consumed Cocoon wallet (${reason})`)
  return true
}
