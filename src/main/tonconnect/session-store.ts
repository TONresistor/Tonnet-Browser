import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { writeSecureJsonAtomic } from '../utils/secure-fs'
import { createLogger } from '../../shared/logger'
import type { TonConnectSession } from '../../shared/types'

const log = createLogger('tonconnect-sessions')

export interface StoredTonConnectSession extends TonConnectSession {
  manifestUrl: string
  address: string
  network: string
  lastEventId: number
  lastRpcId: string | null
}

export class TonConnectSessionStore {
  private cache = new Map<string, StoredTonConnectSession>()

  private filePath(): string {
    return path.join(app.getPath('userData'), 'tonconnect', 'sessions.json')
  }

  init(): void {
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8')
      const parsed = JSON.parse(raw) as StoredTonConnectSession[]
      this.cache.clear()
      for (const s of parsed) {
        if (s && typeof s.domain === 'string') this.cache.set(s.domain, s)
      }
      log.info(`Loaded ${this.cache.size} TON Connect sessions`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('Failed to load TON Connect sessions:', err)
      }
    }
  }

  get(domain: string): StoredTonConnectSession | undefined {
    return this.cache.get(domain)
  }

  has(domain: string): boolean {
    return this.cache.has(domain)
  }

  set(session: StoredTonConnectSession): void {
    this.cache.set(session.domain, session)
    this.persist()
  }

  delete(domain: string): boolean {
    const existed = this.cache.delete(domain)
    if (existed) this.persist()
    return existed
  }

  clear(): void {
    if (this.cache.size === 0) return
    this.cache.clear()
    this.persist()
  }

  list(): TonConnectSession[] {
    return [...this.cache.values()]
      .map((s) => ({
        domain: s.domain,
        appName: s.appName,
        appIconUrl: s.appIconUrl,
        url: s.url,
        grantedAt: s.grantedAt,
      }))
      .sort((a, b) => b.grantedAt - a.grantedAt)
  }

  nextEventId(domain: string): number {
    const session = this.cache.get(domain)
    if (!session) return Date.now()
    session.lastEventId = (session.lastEventId ?? 0) + 1
    this.persist()
    return session.lastEventId
  }

  acceptRpcId(domain: string, id: string): boolean {
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
    this.persist()
    return true
  }

  private persist(): void {
    try {
      writeSecureJsonAtomic(this.filePath(), [...this.cache.values()])
    } catch (err) {
      log.error('Failed to persist TON Connect sessions:', err)
    }
  }
}
