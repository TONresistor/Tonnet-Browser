/**
 * DNS lookup page at ton://dns.
 * Resolves .ton domain records and displays them as flat key/value rows.
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { Search, LoaderCircle, Copy, Check } from 'lucide-react'
import { truncateAddress } from '@/lib/format'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { useTranslation } from 'react-i18next'

interface DnsResult {
  wallet: string | null
  site_adnl: string | null
  has_storage: boolean
  owner: string | null
  nft_address: string | null
  collection: string | null
  editor: string | null
  initialized: boolean
  expiring_at: number | null
  text_records?: Record<string, string>
}

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
      className="ml-2 p-1 rounded hover:bg-surface-hover transition-colors"
      title={copied ? t('copied') : undefined}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  )
}

function DnsPage() {
  const { t } = useTranslation('dns')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<DnsResult | null>(null)
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

  const renderRow = (label: string, value: string | null | boolean, copyable = false) => {
    if (value === null || value === undefined) return null

    let displayValue: string
    if (typeof value === 'boolean') {
      displayValue = value ? t('values.yes') : t('values.no')
    } else {
      displayValue = value
    }

    if (!displayValue || displayValue === '') {
      displayValue = t('values.none')
    }

    const shouldTruncate = typeof value === 'string' && isAddress(value)

    return (
      <div key={label} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center">
          <span className="text-sm font-mono text-foreground">
            {shouldTruncate ? truncateAddress(displayValue, 10, 8) : displayValue}
          </span>
          {copyable && typeof value === 'string' && value.length > 0 && <CopyButton value={value} />}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full bg-background-secondary overflow-auto" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="max-w-lg mx-auto p-5">
        {/* Title */}
        <h1 className="text-xl font-semibold text-foreground text-center mb-5">{t('title')}</h1>

        {/* Search bar */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            placeholder={t('searchPlaceholder')}
            className="w-full h-10 pl-10 pr-4 rounded-full border border-border-medium bg-surface-hover text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-10">
            <LoaderCircle className="h-6 w-6 text-muted-foreground animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground">{t('searching')}</span>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="text-center py-10">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && !searched && (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </div>
        )}

        {/* Not found */}
        {!loading && !error && searched && !hasData && (
          <div className="text-center py-10">
            <p className="text-sm text-muted-foreground">{t('notFound')}</p>
          </div>
        )}

        {/* Results */}
        {!loading && !error && hasData && result && (
          <div>
            {renderRow(t('fields.wallet'), result.wallet, true)}
            {renderRow(t('fields.owner'), result.owner, true)}
            {renderRow(t('fields.siteAdnl'), result.site_adnl, true)}
            {renderRow(t('fields.hasStorage'), result.has_storage)}
            {renderRow(t('fields.expiringAt'), formatExpiry(result.expiring_at))}

            {/* Text records */}
            {result.text_records &&
              Object.keys(result.text_records).length > 0 &&
              Object.entries(result.text_records).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-b-0"
                >
                  <span className="text-xs text-muted-foreground font-mono">
                    TXT {key.length > 12 ? `${key.slice(0, 4)}...${key.slice(-4)}` : key}
                  </span>
                  <div className="flex items-center">
                    <span className="text-sm font-mono text-foreground">{value}</span>
                    <CopyButton value={value} />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(DnsPage)
