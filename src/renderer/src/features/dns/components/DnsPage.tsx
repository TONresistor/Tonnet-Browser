/**
 * DNS lookup page at ton://dns.
 * Focused on main contract records: ADNL (tonsite), Storage, Next resolver, Wallet, TXT
 */
import { useState, useCallback, useRef, useEffect, memo } from 'react'
import { Search, LoaderCircle, Copy, Check, ExternalLink } from 'lucide-react'
import type { ReactNode } from 'react'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { useTranslation } from 'react-i18next'
import type { DnsResolveResult } from '@shared/types'
import { useAddBrowserTab } from '@/features/browser/navigation'
import { dnsClient } from '@/features/dns/client'
import { processNavigationInput } from '@/lib/url-utils'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { AddressChip } from '@/components/ui/ios/AddressChip'
import { ActionButton } from '@/components/ui/ios/ActionButton'

/** Long-identifier value (hex / address): truncated, copyable. Falls back to "Not set". */
function DnsValue({ value }: { value?: string | null }) {
  const { t } = useTranslation('dns')
  if (!value) return <span className="text-muted-foreground">{t('values.notSet', { defaultValue: 'Not set' })}</span>
  return (
    <AddressChip
      address={value}
      startChars={8}
      endChars={6}
      className="bg-transparent px-0 font-mono text-xs text-foreground"
    />
  )
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
      className="ml-1.5 rounded-full p-1 transition-colors hover:bg-surface-hover"
      title={copied ? t('copied') : undefined}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  )
}

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
  const addTab = useAddBrowserTab()

  const [query, setQuery] = useState('')
  const [result, setResult] = useState<DnsResolveResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const getDomain = (d: string) => {
    let v = d.trim().replace(/^https?:\/\//, '')
    if (!v.includes('.')) v = v + '.ton'
    return v
  }

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
        const data = await dnsClient.resolve(domain.trim())
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
      const v = e.target.value
      setQuery(v)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => resolve(v), 500)
    },
    [resolve]
  )

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    []
  )

  const hasData =
    result &&
    (result.site_adnl ||
      result.storage_bag_id ||
      result.has_storage ||
      result.next_resolver ||
      result.wallet ||
      (result.text_records && Object.keys(result.text_records).length > 0))

  return (
    <div className="h-full overflow-auto bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="mx-auto max-w-lg p-5">
        <h1 className="mb-5 text-center text-xl font-semibold text-heading">{t('title')}</h1>

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
          <div className="flex justify-center py-10">
            <LoaderCircle className="h-6 w-6 animate-spin" />
          </div>
        )}
        {!loading && error && <div className="py-10 text-center text-sm text-destructive">{error}</div>}
        {!loading && !error && !searched && (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('empty')}</div>
        )}
        {!loading && !error && searched && !hasData && (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('notFound')}</div>
        )}

        {!loading && !error && hasData && result && (
          <div className="space-y-5">
            <div className="flex items-center justify-center gap-3">
              <h2 className="text-[15px] font-semibold text-heading">{getDomain(query)}</h2>
              {result.site_adnl && (
                <ActionButton
                  variant="filled"
                  className="h-8 px-3 text-[13px]"
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  onClick={() => addTab(processNavigationInput(getDomain(query)))}
                >
                  {t('openSite', { defaultValue: 'Open site' })}
                </ActionButton>
              )}
            </div>

            <InsetGroup>
              <DnsRow label={t('fields.adnl')}>
                <DnsValue value={result.site_adnl} />
              </DnsRow>
              <DnsRow label={t('fields.storage')}>
                {result.storage_bag_id ? (
                  <DnsValue value={result.storage_bag_id} />
                ) : (
                  <span className="text-muted-foreground">
                    {result.has_storage
                      ? t('values.onVisit', { defaultValue: 'Available on visit' })
                      : t('values.notSet', { defaultValue: 'Not set' })}
                  </span>
                )}
              </DnsRow>
              <DnsRow label={t('fields.nextResolver')}>
                <DnsValue value={result.next_resolver} />
              </DnsRow>
              <DnsRow label={t('fields.wallet')}>
                <DnsValue value={result.wallet} />
              </DnsRow>
            </InsetGroup>

            <InsetGroup title={t('fields.textRecords')}>
              {result.text_records && Object.keys(result.text_records).length > 0 ? (
                Object.entries(result.text_records).map(([k, v]) => (
                  <DnsRow key={k} label={k}>
                    <span className="truncate font-mono text-xs">{String(v)}</span>
                    <CopyButton value={String(v)} />
                  </DnsRow>
                ))
              ) : (
                <DnsRow label="">
                  <span className="text-muted-foreground">{t('values.none', { defaultValue: 'None' })}</span>
                </DnsRow>
              )}
            </InsetGroup>
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(DnsPage)
