/**
 * TON DNS tab: owned domains list and domain lookup.
 */

import { useState, useEffect, useRef, memo } from 'react'
import { Globe, Search, LoaderCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'

type OwnedDomain = {
  name: string
  address: string
  owner: string
  expiresAt: number
  walletRecord?: string
}

type LookupResult = {
  name: string
  owner: string
  expiresAt: number
  nftAddress: string
  records: {
    wallet?: string
    site?: string
    storage?: string
    nextResolver?: string
  }
}

function formatExpiry(ts: number): string {
  if (!ts) return '—'
  const ms = ts < 1e12 ? ts * 1000 : ts
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function RecordRow({ label, value, mono = true }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-muted-foreground w-16 flex-shrink-0">{label}</span>
      <span
        className={`text-xs break-all ${value ? 'text-foreground' : 'text-muted-foreground/50'} ${mono && value ? 'font-mono' : ''}`}
      >
        {value || '—'}
      </span>
    </div>
  )
}

export const DnsTab = memo(function DnsTab() {
  const [domains, setDomains] = useState<OwnedDomain[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)

  const [query, setQuery] = useState('')
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.electron.wallet.getDomains().then((result) => {
      setDomains(result)
      setDomainsLoading(false)
    })
  }, [])

  useEffect(() => {
    const trimmed = query.trim()

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!trimmed || !trimmed.endsWith('.ton')) {
      setLookupResult(null)
      setLookupError(null)
      setLookupLoading(false)
      return
    }

    setLookupLoading(true)
    setLookupResult(null)
    setLookupError(null)

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await window.electron.wallet.lookupDomain(trimmed)
        setLookupResult(result)
        setLookupError(null)
      } catch (err) {
        setLookupResult(null)
        setLookupError(err instanceof Error ? err.message : 'Domain not found')
      } finally {
        setLookupLoading(false)
      }
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  return (
    <div className="space-y-4">
      {/* Section 1: My domains */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">My domains</p>
        <div className="glass-card px-3">
          {domainsLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin opacity-60" aria-hidden="true" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : domains.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
              <Globe className="h-5 w-5 opacity-40" aria-hidden="true" />
              <p className="text-sm">No domains found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {domains.map((domain) => (
                <div key={domain.address} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate block">{domain.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{formatExpiry(domain.expiresAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Lookup */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">Lookup</p>
        <div className="relative mb-3">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder="Enter .ton domain…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 text-sm"
          />
        </div>

        {lookupLoading && (
          <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span className="text-sm">Resolving…</span>
          </div>
        )}

        {lookupError && !lookupLoading && <p className="text-sm text-destructive px-1">{lookupError}</p>}

        {lookupResult && !lookupLoading && (
          <div className="glass-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground truncate">{lookupResult.name}</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                Expires {formatExpiry(lookupResult.expiresAt)}
              </span>
            </div>
            <div className="space-y-1.5">
              <RecordRow label="Owner" value={lookupResult.owner} />
              <RecordRow label="NFT" value={lookupResult.nftAddress} />
              <RecordRow label="Wallet" value={lookupResult.records.wallet} />
              <RecordRow label="Site" value={lookupResult.records.site} mono={false} />
              <RecordRow label="Storage" value={lookupResult.records.storage} />
              <RecordRow label="Resolver" value={lookupResult.records.nextResolver} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
