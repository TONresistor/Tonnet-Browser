import * as path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { createLogger } from '../../shared/logger'
import type { TonConnectSession } from '../../shared/types'
import { VersionedJsonRepository } from '../persistence/versioned-json-repository'

const log = createLogger('tonconnect-sessions')
const CURRENT_SCHEMA_VERSION = 1

const StoredSessionSchema = z.object({
  domain: z.string().min(1),
  manifestUrl: z.string(),
  appName: z.string(),
  appIconUrl: z.string().optional(),
  url: z.string(),
  address: z.string(),
  network: z.string(),
  grantedAt: z.number().finite(),
  lastEventId: z.number().int().nonnegative(),
  lastRpcId: z.string().nullable(),
})

const SessionFileSchema = z.object({ sessions: z.array(StoredSessionSchema) })

export interface StoredTonConnectSession extends TonConnectSession {
  manifestUrl: string
  address: string
  network: string
  lastEventId: number
  lastRpcId: string | null
}

export class TonConnectSessionStore {
  private readonly cache = new Map<string, StoredTonConnectSession>()
  private readonly repository: VersionedJsonRepository<{ sessions: StoredTonConnectSession[] }>

  constructor(filePath = path.join(app.getPath('userData'), 'tonconnect', 'sessions.json')) {
    this.repository = new VersionedJsonRepository({
      filePath,
      version: CURRENT_SCHEMA_VERSION,
      schema: SessionFileSchema,
      defaults: () => ({ sessions: [] }),
      migrate: migrateSessionFile,
      mode: 0o600,
      corruption: 'reset-with-backup',
      onCorrupt: (error, backupPath) => {
        log.error(`Quarantined corrupt TON Connect sessions at ${backupPath}:`, error)
      },
    })
  }

  async init(): Promise<void> {
    const { sessions } = await this.repository.load()
    this.cache.clear()
    for (const session of sessions) this.cache.set(session.domain, session)
    log.info(`Loaded ${this.cache.size} TON Connect sessions`)
  }

  get(domain: string): StoredTonConnectSession | undefined {
    return this.cache.get(domain)
  }

  has(domain: string): boolean {
    return this.cache.has(domain)
  }

  async set(session: StoredTonConnectSession): Promise<void> {
    const validated = StoredSessionSchema.parse(session)
    this.cache.set(validated.domain, validated)
    await this.persist()
  }

  async delete(domain: string): Promise<boolean> {
    const existed = this.cache.delete(domain)
    if (existed) await this.persist()
    return existed
  }

  async clear(): Promise<void> {
    if (this.cache.size === 0) return
    this.cache.clear()
    await this.persist()
  }

  list(): TonConnectSession[] {
    return [...this.cache.values()]
      .map((session) => ({
        domain: session.domain,
        appName: session.appName,
        appIconUrl: session.appIconUrl,
        url: session.url,
        grantedAt: session.grantedAt,
      }))
      .sort((a, b) => b.grantedAt - a.grantedAt)
  }

  async nextEventId(domain: string): Promise<number> {
    const session = this.cache.get(domain)
    if (!session) return Date.now()
    session.lastEventId = (session.lastEventId ?? 0) + 1
    await this.persist()
    return session.lastEventId
  }

  async acceptRpcId(domain: string, id: string): Promise<boolean> {
    const session = this.cache.get(domain)
    if (!session) return false
    const last = session.lastRpcId
    if (last !== null && last !== undefined) {
      try {
        if (BigInt(id) <= BigInt(last)) return false
      } catch {
        if (id <= last) return false
      }
    }
    session.lastRpcId = id
    await this.persist()
    return true
  }

  private persist(): Promise<void> {
    return this.repository.save({ sessions: [...this.cache.values()] })
  }
}

function migrateSessionFile(raw: unknown): unknown {
  if (Array.isArray(raw)) return { sessions: raw }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { sessions?: unknown }).sessions)) {
    return { sessions: (raw as { sessions: unknown[] }).sessions }
  }
  return { sessions: [] }
}
