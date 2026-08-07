import { getSetting, transactSettings } from '../settings'
import type { BridgePermission, BridgeScope, BridgeDecision } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('bridge-permissions')

// WRITE scope: methods that broadcast or modify network state.
const WRITE_METHODS = new Set([
  'dht.storeAddress',
  'dht.storeOverlayNodes',
  'lite.sendMessage',
  'lite.sendMessageWait',
  'lite.sendAndWatch',
  'adnl.sendMessage',
  'adnl.setQueryHandler',
  'adnl.answer',
  'overlay.sendMessage',
  'overlay.setQueryHandler',
  'overlay.answer',
])
// P2P scope: connection namespaces.
const P2P_NAMESPACES = new Set(['adnl', 'overlay', 'dht'])
// READ scope: blockchain query namespaces.
const READ_NAMESPACES = new Set(['lite', 'subscribe', 'dns', 'jetton', 'nft', 'wallet', 'sbt', 'payment', 'network'])

/**
 * Maps a JSON-RPC method name to a permission scope.
 */
export function methodToScope(method: string): BridgeScope | null {
  if (WRITE_METHODS.has(method)) return 'write'
  const ns = method.split('.')[0]
  if (P2P_NAMESPACES.has(ns)) return 'p2p'
  if (READ_NAMESPACES.has(ns)) return 'blockchain'
  return null
}

export const SCOPE_DESCRIPTIONS: Record<BridgeScope, string> = {
  blockchain: 'query blockchain data (accounts, transactions, DNS)',
  p2p: 'connect to the TON P2P network (ADNL, DHT, overlays)',
  write: 'broadcast data to the network',
}

interface SessionGrant {
  grantedAt: number
}

export class BridgePermissionStore {
  private sessionGrants = new Map<string, SessionGrant>()
  private sessionGenerations = new Map<string, number>()
  private sessionEpoch = 0
  private mutationTail: Promise<void> | null = null

  private key(domain: string, scope: BridgeScope): string {
    return `${domain}:${scope}`
  }

  private parseKey(key: string): { domain: string; scope: BridgeScope } {
    const lastColon = key.lastIndexOf(':')
    return { domain: key.substring(0, lastColon), scope: key.substring(lastColon + 1) as BridgeScope }
  }

  init(): void {
    const { permissions } = getSetting('bridge')
    log.debug(`Loaded ${permissions.length} bridge permissions`)
  }

  getPermission(domain: string, scope: BridgeScope): BridgeDecision | 'unknown' {
    const key = this.key(domain, scope)
    const persistent = getSetting('bridge').permissions.find(
      (permission) => this.key(permission.domain, permission.scope) === key
    )
    return persistent?.decision ?? (this.sessionGrants.has(key) ? 'session' : 'unknown')
  }

  setPermission(domain: string, scope: BridgeScope, decision: BridgeDecision): Promise<void> {
    const key = this.key(domain, scope)
    if (decision === 'session') {
      const epoch = this.sessionEpoch
      const generation = this.sessionGeneration(key)
      return this.enqueueMutation(async () => {
        if (epoch !== this.sessionEpoch || generation !== this.sessionGeneration(key)) return
        this.sessionGrants.set(key, { grantedAt: Date.now() })
        log.event('info', 'bridge.permission.set', 'bridge permission updated', { scope, decision })
      })
    }
    return this.enqueueMutation(async () => {
      await transactSettings(
        (current) => ({
          ...current,
          bridge: {
            ...current.bridge,
            permissions: [
              ...current.bridge.permissions.filter(
                (permission) => this.key(permission.domain, permission.scope) !== key
              ),
              { domain, scope, decision, grantedAt: Date.now() },
            ],
          },
        }),
        async () => {}
      )
      this.invalidateSession(key)
      log.event('info', 'bridge.permission.set', 'bridge permission updated', { scope, decision })
    })
  }

  revokePermission(domain: string, scope: BridgeScope): Promise<void> {
    const key = this.key(domain, scope)
    this.invalidateSession(key)
    return this.enqueueMutation(async () => {
      await transactSettings(
        (current) => ({
          ...current,
          bridge: {
            ...current.bridge,
            permissions: current.bridge.permissions.filter(
              (permission) => this.key(permission.domain, permission.scope) !== key
            ),
          },
        }),
        async () => {}
      )
      log.event('info', 'bridge.permission.revoked', 'bridge permission revoked', { scope })
    })
  }

  revokeSessionPermission(domain: string, scope: BridgeScope): void {
    this.invalidateSession(this.key(domain, scope))
  }

  getAllPermissions(): BridgePermission[] {
    const result = getSetting('bridge').permissions.map((permission) => ({ ...permission }))
    const persistentKeys = new Set(result.map((grant) => this.key(grant.domain, grant.scope)))
    for (const [key, grant] of this.sessionGrants) {
      if (persistentKeys.has(key)) continue
      const { domain, scope } = this.parseKey(key)
      result.push({ domain, scope, decision: 'session', grantedAt: grant.grantedAt })
    }
    return result
  }

  clearSessionGrants(): void {
    const cleared = this.sessionGrants.size
    this.sessionEpoch += 1
    this.sessionGenerations.clear()
    this.sessionGrants.clear()
    if (cleared > 0) {
      log.info(`Cleared ${cleared} session-only grants`)
    }
  }

  getDefaultPolicy(): 'ask' | 'deny' {
    return getSetting('bridge').defaultPolicy
  }

  private sessionGeneration(key: string): number {
    return this.sessionGenerations.get(key) ?? 0
  }

  private invalidateSession(key: string): void {
    this.sessionGenerations.set(key, this.sessionGeneration(key) + 1)
    this.sessionGrants.delete(key)
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const previous = this.mutationTail
    const result = previous ? previous.catch(() => undefined).then(operation) : operation()
    const owned = result.finally(() => {
      if (this.mutationTail === owned) this.mutationTail = null
    })
    this.mutationTail = owned
    return owned
  }
}

// Singleton removed: use ServiceRegistry from services.ts
