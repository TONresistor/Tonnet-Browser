/**
 * Per-site payment permission management.
 * Allows toggling payment mode (off/manual/auto) per domain.
 */

import { useState, useEffect, useCallback } from 'react'
import { Globe, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isIpcError } from '@/lib/ipc-utils'
import { formatTonAmount } from '@/stores/wallet'
import type { SitePolicy, PaymentMode } from '@shared/types'

const MODE_LABELS: Record<PaymentMode, string> = {
  off: 'Off',
  manual: 'Manual',
  auto: 'Auto',
}

const MODE_COLORS: Record<PaymentMode, string> = {
  off: 'text-muted-foreground',
  manual: 'text-warning',
  auto: 'text-success',
}

export function SitePermissions() {
  const [policies, setPolicies] = useState<SitePolicy[]>([])

  const loadPolicies = useCallback(async () => {
    const settings = await window.electron.settings.get('wallet')
    if (settings && settings.sitePolicies) {
      setPolicies(settings.sitePolicies)
    }
  }, [])

  useEffect(() => {
    loadPolicies()
  }, [loadPolicies])

  const updateMode = useCallback(
    async (domain: string, mode: PaymentMode) => {
      const updated = policies.map((p) => (p.domain === domain ? { ...p, mode } : p))
      const result = await window.electron.settings.set('wallet', { sitePolicies: updated })
      if (isIpcError(result)) return
      setPolicies(updated)
    },
    [policies]
  )

  const removeSite = useCallback(
    async (domain: string) => {
      const updated = policies.filter((p) => p.domain !== domain)
      const result = await window.electron.settings.set('wallet', { sitePolicies: updated })
      if (isIpcError(result)) return
      setPolicies(updated)
    },
    [policies]
  )

  if (policies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <Globe className="h-6 w-6 opacity-40" />
        <p className="text-sm">No site-specific policies configured</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border">
      {policies.map((policy) => (
        <div key={policy.domain} className="flex items-center gap-3 py-3 px-1">
          <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />

          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{policy.domain}</div>
            <div className="text-xs text-muted-foreground">Spent: {formatTonAmount(policy.totalSpent)} TON</div>
          </div>

          <select
            value={policy.mode}
            onChange={(e) => updateMode(policy.domain, e.target.value as PaymentMode)}
            className={cn('text-xs px-2 py-1 rounded border border-border bg-background', MODE_COLORS[policy.mode])}
          >
            {Object.entries(MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <button
            onClick={() => removeSite(policy.domain)}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove site policy"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
