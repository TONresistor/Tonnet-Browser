/**
 * History Page - ton://history
 * Display and manage browsing history with 2 privacy modes.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createLogger } from '@/logger'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { Search, Trash2, Clock, ExternalLink, History, TriangleAlert, Copy, Check } from 'lucide-react'
import { useConfirmAction } from '../../hooks/useConfirmAction'

const log = createLogger('history')
import { useTranslation } from 'react-i18next'
import { useTabsStore } from '../../stores/tabs'
import { ErrorBoundary } from '../ErrorBoundary'
import { cn } from '@/lib/utils'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { Segmented } from '@/components/ui/ios/Segmented'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import type { HistoryEntry } from '@shared/types'

type TimeFilter = 'today' | 'week' | 'month' | 'all'

export function HistoryPage() {
  const { t, i18n } = useTranslation('pages')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const deleteConfirm = useConfirmAction()
  const clearAllConfirm = useConfirmAction()
  const clearRangeConfirm = useConfirmAction()
  const addTab = useTabsStore((state) => state.addTab)

  const loadSeq = useRef(0)
  const loadHistory = useCallback(async () => {
    const seq = ++loadSeq.current
    setIsLoading(true)
    try {
      let results: HistoryEntry[] = []

      if (query) {
        results = await window.electron.history.search(query, 100)
      } else if (timeFilter === 'today') {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        results = await window.electron.history.getByDate(start.getTime(), Date.now())
      } else if (timeFilter === 'week') {
        const start = new Date()
        start.setDate(start.getDate() - 7)
        results = await window.electron.history.getByDate(start.getTime(), Date.now())
      } else if (timeFilter === 'month') {
        const start = new Date()
        start.setMonth(start.getMonth() - 1)
        results = await window.electron.history.getByDate(start.getTime(), Date.now())
      } else {
        results = await window.electron.history.getRecent(100)
      }

      // Ignore a slow response that a newer load has already superseded.
      if (seq === loadSeq.current) setEntries(results)
    } catch (error) {
      log.error('Failed to load history:', error)
      if (seq === loadSeq.current) setEntries([])
    }
    if (seq === loadSeq.current) setIsLoading(false)
  }, [query, timeFilter])

  useEffect(() => {
    // Debounce search
    const timeoutId = setTimeout(
      () => {
        loadHistory()
      },
      query ? 300 : 0
    ) // Only debounce for search, not for filter changes

    return () => clearTimeout(timeoutId)
  }, [query, timeFilter, loadHistory])

  const handleDelete = async (id: string) => {
    if (deleteConfirm.trigger(id)) {
      const result = await window.electron.history.delete(id)
      if (result.success) {
        loadHistory()
      }
    }
  }

  const handleClearAll = async () => {
    if (clearAllConfirm.trigger()) {
      const result = await window.electron.history.clear()
      if (result.success) {
        loadHistory()
      }
    }
  }

  const handleClearTimeRange = async (range: 'hour' | 'day') => {
    if (clearRangeConfirm.trigger(range)) {
      const now = Date.now()
      const start = new Date(now)

      if (range === 'hour') {
        start.setHours(start.getHours() - 1)
      } else {
        start.setDate(start.getDate() - 1)
      }

      await window.electron.history.deleteByDate(start.getTime(), now)

      loadHistory()
    }
  }

  const openInNewTab = (url: string) => {
    addTab(url)
  }

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), UI_COPY_FEEDBACK_MS)
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return t('history.timeFormat.justNow')
    if (diff < 3600000) return t('history.timeFormat.minuteAgo', { count: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('history.timeFormat.hourAgo', { count: Math.floor(diff / 3600000) })
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    return date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  // Group entries by date (memoized to avoid recalculation on every render)
  const groupedEntries = useMemo(() => {
    return entries.reduce(
      (groups, entry) => {
        const date = new Date(entry.visitedAt)
        const dateKey = date.toISOString().slice(0, 10)
        const displayLabel = date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })
        if (!groups[dateKey]) groups[dateKey] = { label: displayLabel, entries: [] }
        groups[dateKey].entries.push(entry)
        return groups
      },
      {} as Record<string, { label: string; entries: HistoryEntry[] }>
    )
  }, [entries, i18n.language])

  const timeOptions: { value: TimeFilter; label: string }[] = [
    { value: 'all', label: t('history.filters.all') },
    { value: 'today', label: t('history.filters.today') },
    { value: 'week', label: t('history.filters.thisWeek') },
    { value: 'month', label: t('history.filters.thisMonth') },
  ]

  return (
    <ErrorBoundary>
      <div className="h-full overflow-auto bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
        <div className="mx-auto max-w-3xl p-5">
          {/* Header */}
          <div className="mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold text-foreground">{t('history.title')}</h1>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('history.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-full bg-surface pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Filter + clear */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              value={timeFilter}
              onChange={setTimeFilter}
              options={timeOptions}
              ariaLabel={t('history.title')}
            />
            <div className="flex items-center gap-1.5">
              <ClearPill armed={clearRangeConfirm.isArmed('hour')} onClick={() => handleClearTimeRange('hour')}>
                {t('history.actions.clearLastHour')}
              </ClearPill>
              <ClearPill armed={clearRangeConfirm.isArmed('day')} onClick={() => handleClearTimeRange('day')}>
                {t('history.actions.clearLastDay')}
              </ClearPill>
              <button
                onClick={handleClearAll}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  clearAllConfirm.isArmed()
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                )}
              >
                {clearAllConfirm.isArmed() ? (
                  <TriangleAlert className="h-3.5 w-3.5" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('history.actions.clearAll')}
              </button>
            </div>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Lottie animationData={explorerAnimation} className="mb-3 h-28 w-28" loop autoplay />
              <p className="text-sm text-muted-foreground">{t('history.loading')}</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Lottie animationData={explorerAnimation} className="mb-4 h-32 w-32" loop autoplay />
              <h3 className="text-base font-semibold text-foreground">
                {query ? t('history.empty.noResults') : t('history.empty.title')}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {query ? t('history.empty.tryDifferent') : t('history.empty.description')}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {Object.entries(groupedEntries).map(([dateKey, { label, entries: dateEntries }]) => (
                <div key={dateKey} className="space-y-2">
                  <h2 className="px-1 text-[13px] font-medium text-muted-foreground">{label}</h2>
                  <InsetGroup bodyClassName="divide-y divide-border-subtle">
                    {dateEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                      >
                        {entry.favicon ? (
                          <img src={entry.favicon} alt="" className="h-4 w-4 shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openInNewTab(entry.url)}
                              className="truncate text-left text-[14px] font-medium text-foreground transition-colors hover:text-primary"
                            >
                              {entry.title || entry.url}
                            </button>
                            {entry.visitCount > 1 && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {t('history.visitsCount', { count: entry.visitCount })}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{entry.url}</div>
                        </div>

                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDate(entry.visitedAt)}
                        </span>

                        {/* Hover actions */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <RowAction title={t('history.actions.openInNewTab')} onClick={() => openInNewTab(entry.url)}>
                            <ExternalLink className="h-4 w-4" />
                          </RowAction>
                          <RowAction title={t('history.actions.copyUrl')} onClick={() => copyUrl(entry.url, entry.id)}>
                            {copiedId === entry.id ? (
                              <Check className="h-4 w-4 text-success" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </RowAction>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            title={t('history.actions.delete')}
                            className={cn(
                              'rounded-full p-1.5 transition-colors',
                              deleteConfirm.isArmed(entry.id)
                                ? 'bg-destructive/15 text-destructive'
                                : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                            )}
                          >
                            {deleteConfirm.isArmed(entry.id) ? (
                              <TriangleAlert className="h-4 w-4" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </InsetGroup>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  )
}

function ClearPill({ armed, onClick, children }: { armed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
        armed ? 'bg-destructive/15 text-destructive' : 'bg-surface text-muted-foreground hover:bg-surface-hover'
      )}
    >
      {armed && <TriangleAlert className="h-3 w-3" />}
      {children}
    </button>
  )
}

function RowAction({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
    >
      {children}
    </button>
  )
}
