/**
 * DNS lookup page at ton://dns.
 * Resolves .ton domain records and displays them as flat key/value rows.
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { Search, LoaderCircle, Copy, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { truncateAddress } from '@/lib/format'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { useTranslation } from 'react-i18next'
import type { DnsResolveResult } from '@shared/types'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { AddressChip } from '@/components/ui/ios/AddressChip'

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation('dns')
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }, [value])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-1.5 rounded-full p-1 transition-colors hover:bg-surface-hover"
      title={copied ? t('copied') : undefined}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  )
}

/** A label / value row inside the records InsetGroup. */
function DnsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center justify-end text-sm text-foreground">{children}</span>
    </div>
  )
}

function DnsPage() {
  const { t } = useTranslation('dns')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<DnsResolveResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const resolve = useCallback(
    async (domain: string) => {
      if (!domain.trim()) {
        setResult(null)
        setError(null)
        setSearched(false)
        return
      }

      setLoading(true)
      setError(null)
      setSearched(true)

      try {
        const data = await window.electron.dns.resolve(domain.trim())
        setResult(data)
      } catch {
        setResult(null)
        setError(t('error'))
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        resolve(value)
      }, 500)
    },
    [resolve]
  )

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const isAddress = (val: string | null): boolean => {
    if (!val) return false
    return val.length > 30
  }

  const formatExpiry = (ts: number | null): string => {
    if (ts === null || ts === undefined) return t('values.none')
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  const hasData =
    result && (result.wallet || result.site_adnl || result.has_storage || result.owner || result.expiring_at)

  // Render an address value as a copyable chip, anything else as plain text.
  const renderValue = (value: string | null | boolean, copyable = false): ReactNode => {
    if (value === null || value === undefined) return null
    if (typeof value === 'boolean') return value ? t('values.yes') : t('values.no')
    if (!value) return t('values.none')
    if (isAddress(value)) {
      return <AddressChip address={value} startChars={10} endChars={8} className="bg-transparent px-0 font-mono" />
    }
    return (
      <span className="flex min-w-0 items-center">
        <span className="truncate">{value}</span>
        {copyable && <CopyButton value={value} />}
      </span>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="mx-auto max-w-lg p-5">
        <h1 className="mb-5 text-center text-xl font-semibold text-foreground">{t('title')}</h1>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder={t('searchPlaceholder')}
            className="h-10 w-full rounded-full bg-surface pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center py-10">
            <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">{t('searching')}</span>
          </div>
        )}

        {!loading && error && <p className="py-10 text-center text-sm text-destructive">{error}</p>}

        {!loading && !error && !searched && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</p>
        )}

        {!loading && !error && searched && !hasData && (
          <p className="py-10 text-center text-sm text-muted-foreground">{t('notFound')}</p>
        )}

        {!loading && !error && hasData && result && (
          <InsetGroup>
            {result.wallet && <DnsRow label={t('fields.wallet')}>{renderValue(result.wallet, true)}</DnsRow>}
            {result.owner && <DnsRow label={t('fields.owner')}>{renderValue(result.owner, true)}</DnsRow>}
            {result.site_adnl && <DnsRow label={t('fields.siteAdnl')}>{renderValue(result.site_adnl, true)}</DnsRow>}
            {result.has_storage !== null && result.has_storage !== undefined && (
              <DnsRow label={t('fields.hasStorage')}>{renderValue(result.has_storage)}</DnsRow>
            )}
            {result.expiring_at !== null && result.expiring_at !== undefined && (
              <DnsRow label={t('fields.expiringAt')}>{formatExpiry(result.expiring_at)}</DnsRow>
            )}

            {result.text_records &&
              Object.entries(result.text_records).map(([key, value]) => (
                <DnsRow key={key} label={`TXT ${key.length > 12 ? `${truncateAddress(key, 4, 4)}` : key}`}>
                  <span className="flex min-w-0 items-center">
                    <span className="truncate font-mono">{value}</span>
                    <CopyButton value={value} />
                  </span>
                </DnsRow>
              ))}
          </InsetGroup>
        )}
      </div>
    </div>
  )
}

export default memo(DnsPage)
