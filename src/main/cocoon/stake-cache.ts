/**
 * Persistent cache for the cocoon_client SC + proxy SC addresses.
 *
 * Why a separate file (not the encrypted wallet store):
 *  - These addresses are public on-chain identifiers, no need to encrypt.
 *  - Updated on every successful /jsonstats read while the runner is ready,
 *    so we want a cheap fsync without touching the safeStorage hot path.
 *  - Survives runner restarts: we keep showing the stake panel and on-chain
 *    state in Settings even when the runner is stopped or crashed.
 *
 * Schema is intentionally minimal — adding fields requires a migration only if
 * old caches must be read at boot, which is fine since stale data is just
 * re-cached on the next /jsonstats success.
 */

import { join } from 'path'
import { app } from 'electron'
import { z } from 'zod'
import type { CocoonPendingWithdraw } from '../../shared/cocoon-types'
import { VersionedJsonRepository } from '../persistence/versioned-json-repository'

const FILE_NAME = 'cocoon-stake.json'

export type PendingWithdraw = CocoonPendingWithdraw

export interface StakeCache {
  /** Proxy SC address used as the `proxy=` query param for /request/* endpoints. */
  proxySCAddress?: string
  /** Client SC address — used to read state on-chain when the runner is offline. */
  clientSCAddress?: string
  /** Owner's V4R2 address at the time of caching (sanity check on read). */
  ownerAddress?: string
  /**
   * Persisted user intent: the user requested a complete withdraw (unstake +
   * cashout). The driver auto-progresses through cooldown → claim → cashout
   * across app restarts. Cleared once cashout settles.
   */
  pendingWithdraw?: PendingWithdraw | null
  /** Unix ms timestamp of the last successful refresh. */
  fundingOperations?: Record<string, { operationId: string; amount: string; sourceAddress: string }>
  cachedAt: number
}

const PendingWithdrawSchema = z.object({
  startedAt: z.number().finite(),
  nativeWalletPublicKey: z.string().optional(),
  nativeWalletAddress: z.string().optional(),
  lastActionAt: z.number().finite().optional(),
  lastBocHash: z.string().optional(),
})
const StakeCacheSchema = z.object({
  fundingOperations: z
    .record(z.string(), z.object({ operationId: z.string(), amount: z.string(), sourceAddress: z.string() }))
    .optional(),
  proxySCAddress: z.string().optional(),
  clientSCAddress: z.string().optional(),
  ownerAddress: z.string().optional(),
  pendingWithdraw: PendingWithdrawSchema.nullish(),
  cachedAt: z.number().finite(),
})

export class StakeCacheStore {
  private fundingTail: Promise<unknown> = Promise.resolve()
  private mutationTail: Promise<unknown> = Promise.resolve()
  private filePath: string
  private cached: StakeCache | null = null
  private repository: VersionedJsonRepository<StakeCache>

  constructor(basePath?: string) {
    const dir = basePath ?? app.getPath('userData')
    this.filePath = join(dir, FILE_NAME)
    this.repository = new VersionedJsonRepository({
      filePath: this.filePath,
      version: 1,
      schema: StakeCacheSchema,
      defaults: () => ({ cachedAt: 0 }),
      migrate: (raw) => raw,
      mode: 0o600,
    })
  }

  async load(): Promise<StakeCache | null> {
    if (this.cached) return this.cached
    const loaded = await this.repository.loadOptional()
    if (!this.cached) this.cached = loaded
    return this.cached
  }

  async save(data: StakeCache): Promise<void> {
    const write = this.mutationTail
      .catch(() => undefined)
      .then(async () => {
        const merged = {
          ...data,
          ...(this.cached?.fundingOperations || data.fundingOperations
            ? { fundingOperations: { ...this.cached?.fundingOperations, ...data.fundingOperations } }
            : {}),
        }
        await this.repository.save(merged)
        this.cached = StakeCacheSchema.parse(merged)
      })
    this.mutationTail = write
    await write
  }

  /** Update public stake addresses while preserving any pending withdraw intent. */
  async saveStakeAddresses(data: {
    proxySCAddress: string
    clientSCAddress: string
    ownerAddress: string
    cachedAt: number
  }): Promise<void> {
    const cache = await this.load()
    await this.save({ ...cache, ...data })
  }

  async reserveFunding(key: string, amount: string, sourceAddress: string): Promise<string> {
    const reservation = this.fundingTail
      .catch(() => undefined)
      .then(async () => {
        const cache = (await this.load()) ?? { cachedAt: Date.now() }
        const existing = cache.fundingOperations?.[key]
        if (existing) {
          if (existing.sourceAddress !== sourceAddress) throw new Error('Funding belongs to another native wallet')
          if (existing.amount !== amount) throw new Error('Funding amount changed while an operation is pending')
          return existing.operationId
        }
        const operationId = crypto.randomUUID()
        await this.save({
          ...cache,
          fundingOperations: { ...cache.fundingOperations, [key]: { operationId, amount, sourceAddress } },
        })
        return operationId
      })
    this.fundingTail = reservation
    return reservation
  }

  async clear(): Promise<void> {
    const deletion = this.mutationTail
      .catch(() => undefined)
      .then(async () => {
        await this.repository.remove()
        this.cached = null
      })
    this.mutationTail = deletion
    await deletion
  }

  /** Read the pending withdraw intent (null if absent or no cache yet). */
  async getPendingWithdraw(): Promise<PendingWithdraw | null> {
    const cache = await this.load()
    return cache?.pendingWithdraw ?? null
  }

  /**
   * Set the pending withdraw flag. Preserves any existing address fields so
   * the driver can keep reading on-chain state across restarts.
   */
  async setPendingWithdraw(intent: PendingWithdraw): Promise<void> {
    const cache = (await this.load()) ?? { cachedAt: Date.now() }
    await this.save({ ...cache, pendingWithdraw: intent, cachedAt: Date.now() })
  }

  /** Clear the pending withdraw flag (kept addresses untouched). */
  async clearPendingWithdraw(): Promise<void> {
    const cache = await this.load()
    if (!cache || !cache.pendingWithdraw) return
    await this.save({ ...cache, pendingWithdraw: null, cachedAt: Date.now() })
  }

  /** Test-only: returns the file path. */
  getFilePath(): string {
    return this.filePath
  }
}
