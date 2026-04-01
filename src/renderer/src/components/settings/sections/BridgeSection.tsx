/**
 * Bridge permissions settings section.
 * Lists per-domain bridge permissions with revoke controls.
 */

import { useState, useEffect } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import type { BridgePermission } from '@shared/types'

const SCOPE_LABELS: Record<string, string> = {
  blockchain: 'Blockchain',
  p2p: 'P2P Network',
  write: 'Write/Broadcast',
}

const DECISION_LABELS: Record<string, string> = {
  granted: 'Always',
  denied: 'Denied',
  session: 'Session',
}

export function BridgeSection() {
  const [permissions, setPermissions] = useState<BridgePermission[]>([])

  const loadPermissions = async (): Promise<void> => {
    const result = await window.electron.bridge.getPermissions()
    if (Array.isArray(result)) setPermissions(result)
  }

  useEffect(() => {
    loadPermissions()
  }, [])

  const handleRevoke = async (domain: string, scope: string): Promise<void> => {
    await window.electron.bridge.revokePermission(domain, scope)
    loadPermissions()
  }

  const grouped = permissions.reduce(
    (acc, p) => {
      if (!acc[p.domain]) acc[p.domain] = []
      acc[p.domain].push(p)
      return acc
    },
    {} as Record<string, BridgePermission[]>
  )

  return (
    <div>
      <SectionHeader title="Bridge Permissions" description="Control which TON sites can access bridge features." />
      {Object.keys(grouped).length === 0 ? (
        <p className="text-muted-foreground text-sm">No site permissions yet.</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([domain, perms]) => (
            <div key={domain} className="glass-card p-4">
              <h4 className="text-foreground font-medium mb-3">{domain}</h4>
              <div className="space-y-2">
                {perms.map((p) => (
                  <div key={`${p.domain}:${p.scope}`} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-foreground">{SCOPE_LABELS[p.scope] || p.scope}</span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          p.decision === 'granted'
                            ? 'bg-green-500/20 text-green-400'
                            : p.decision === 'denied'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {DECISION_LABELS[p.decision] || p.decision}
                      </span>
                      <button
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => handleRevoke(p.domain, p.scope)}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
