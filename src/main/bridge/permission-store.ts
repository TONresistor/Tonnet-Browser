import { getSetting, setSetting } from '../settings'
import type { BridgePermission, BridgeScope, BridgeDecision } from '../../shared/types'
import { createLogger } from '../../shared/logger'
const log = createLogger('bridge-permissions')

/**
 * Maps a JSON-RPC method name to a permission scope.
 */
export function methodToScope(method: string): BridgeScope | null {
  const ns = method.split('.')[0]

  // WRITE scope: methods that broadcast or modify state
  const writeMethods = [
    'dht.storeAddress',
    'dht.storeOverlayNodes',
    'lite.sendMessage',
    'lite.sendMessageWait',
    'lite.sendAndWatch',
  ]
  for (const wm of writeMethods) {
    if (method === wm) return 'write'
  }

  // Also catch adnl/overlay write methods
  const writePatterns = [
    'adnl.sendMessage',
    'adnl.setQueryHandler',
    'adnl.answer',
    'overlay.sendMessage',
    'overlay.setQueryHandler',
    'overlay.answer',
  ]
  for (const wp of writePatterns) {
    if (method === wp) return 'write'
  }

  // CONNECT scope: P2P connection methods
  const connectNamespaces = ['adnl', 'overlay', 'dht']
  if (connectNamespaces.includes(ns)) return 'p2p'

  // READ scope: everything else
  const readNamespaces = ['lite', 'subscribe', 'dns', 'jetton', 'nft', 'wallet', 'sbt', 'payment', 'network']
  if (readNamespaces.includes(ns)) return 'blockchain'

  return null
}

export const SCOPE_DESCRIPTIONS: Record<BridgeScope, string> = {
  blockchain: 'query blockchain data (accounts, transactions, DNS)',
  p2p: 'connect to the TON P2P network (ADNL, DHT, overlays)',
  write: 'broadcast data to the network',
}

export class BridgePermissionStore {
  private cache = new Map<string, BridgeDecision>()

  private key(domain: string, scope: BridgeScope): string {
    return `${domain}:${scope}`
  }

  init(): void {
    const { permissions } = getSetting('bridge')
    this.cache.clear()
    for (const p of permissions) {
      this.cache.set(this.key(p.domain, p.scope), p.decision)
    }
    log.info(`Loaded ${permissions.length} bridge permissions`)
  }

  getPermission(domain: string, scope: BridgeScope): BridgeDecision | 'unknown' {
    return this.cache.get(this.key(domain, scope)) ?? 'unknown'
  }

  setPermission(domain: string, scope: BridgeScope, decision: BridgeDecision): void {
    this.cache.set(this.key(domain, scope), decision)
    this.persist()
    log.info(`Permission set: ${domain} / ${scope} = ${decision}`)
  }

  revokePermission(domain: string, scope: BridgeScope): void {
    this.cache.delete(this.key(domain, scope))
    this.persist()
    log.info(`Permission revoked: ${domain} / ${scope}`)
  }

  getAllPermissions(): BridgePermission[] {
    const result: BridgePermission[] = []
    for (const [key, decision] of this.cache) {
      const lastColon = key.lastIndexOf(':')
      result.push({
        domain: key.substring(0, lastColon),
        scope: key.substring(lastColon + 1) as BridgeScope,
        decision,
        grantedAt: Date.now(),
      })
    }
    return result
  }

  clearSessionGrants(): void {
    const entries = [...this.cache.entries()]
    let cleared = 0
    for (const [key, decision] of entries) {
      if (decision === 'session') {
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
    for (const [key, decision] of this.cache) {
      if (decision === 'session') continue
      const lastColon = key.lastIndexOf(':')
      const domain = key.substring(0, lastColon)
      const scope = key.substring(lastColon + 1) as BridgeScope
      permissions.push({ domain, scope, decision, grantedAt: Date.now() })
    }
    setSetting('bridge', { permissions })
  }
}

// Singleton removed: use ServiceRegistry from services.ts
