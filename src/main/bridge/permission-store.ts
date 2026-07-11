import { getSetting, setSetting } from '../settings'
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

interface CachedGrant {
  decision: BridgeDecision
  grantedAt: number
}

export class BridgePermissionStore {
  private cache = new Map<string, CachedGrant>()

  private key(domain: string, scope: BridgeScope): string {
    return `${domain}:${scope}`
  }

  private parseKey(key: string): { domain: string; scope: BridgeScope } {
    const lastColon = key.lastIndexOf(':')
    return { domain: key.substring(0, lastColon), scope: key.substring(lastColon + 1) as BridgeScope }
  }

  init(): void {
    const { permissions } = getSetting('bridge')
    this.cache.clear()
    for (const p of permissions) {
      this.cache.set(this.key(p.domain, p.scope), { decision: p.decision, grantedAt: p.grantedAt })
    }
    log.debug(`Loaded ${permissions.length} bridge permissions`)
  }

  getPermission(domain: string, scope: BridgeScope): BridgeDecision | 'unknown' {
    return this.cache.get(this.key(domain, scope))?.decision ?? 'unknown'
  }

  setPermission(domain: string, scope: BridgeScope, decision: BridgeDecision): void {
    this.cache.set(this.key(domain, scope), { decision, grantedAt: Date.now() })
    this.persist()
    log.event('info', 'bridge.permission.set', 'bridge permission updated', { scope, decision })
  }

  revokePermission(domain: string, scope: BridgeScope): void {
    this.cache.delete(this.key(domain, scope))
    this.persist()
    log.event('info', 'bridge.permission.revoked', 'bridge permission revoked', { scope })
  }

  getAllPermissions(): BridgePermission[] {
    const result: BridgePermission[] = []
    for (const [key, grant] of this.cache) {
      const { domain, scope } = this.parseKey(key)
      result.push({ domain, scope, decision: grant.decision, grantedAt: grant.grantedAt })
    }
    return result
  }

  clearSessionGrants(): void {
    const entries = [...this.cache.entries()]
    let cleared = 0
    for (const [key, grant] of entries) {
      if (grant.decision === 'session') {
        this.cache.delete(key)
        cleared++
      }
    }
    if (cleared > 0) {
      this.persist()
      log.info(`Cleared ${cleared} session-only grants`)
    }
  }

  getDefaultPolicy(): 'ask' | 'deny' {
    return getSetting('bridge').defaultPolicy
  }

  private persist(): void {
    const permissions: BridgePermission[] = []
    for (const [key, grant] of this.cache) {
      if (grant.decision === 'session') continue
      const { domain, scope } = this.parseKey(key)
      permissions.push({ domain, scope, decision: grant.decision, grantedAt: grant.grantedAt })
    }
    void setSetting('bridge', { permissions }).catch((error) =>
      log.error('Failed to persist bridge permission:', error)
    )
  }
}

// Singleton removed: use ServiceRegistry from services.ts
