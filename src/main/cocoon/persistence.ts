import type { ConsumedArchive } from './consumed-archive'
import type { RecoveryQueueStore } from './recovery-queue'
import type { StakeCacheStore } from './stake-cache'

/** Explicit owner for Cocoon persistence capabilities. */
export interface CocoonPersistence {
  consumedArchive: ConsumedArchive
  recoveryQueue: RecoveryQueueStore
  stakeCache: StakeCacheStore
}
