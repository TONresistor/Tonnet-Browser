/**
 * History Page - ton://history
 * Display and manage browsing history with 2 privacy modes.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createLogger } from '@/logger'
import { UI_COPY_FEEDBACK_MS, UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'
import { Search, Trash2, Clock, ExternalLink, Filter, History, TriangleAlert } from 'lucide-react'

const log = createLogger('history')
import { useTranslation } from 'react-i18next'
import { useTabsStore } from '../../stores/tabs'
import { ErrorBoundary } from '../ErrorBoundary'
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
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingClearAll, setPendingClearAll] = useState(false)
  const [pendingClearRange, setPendingClearRange] = useState<string | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearAllTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearRangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addTab = useTabsStore((state) => state.addTab)

  const loadHistory = useCallback(async () => {
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

      setEntries(results)
    } catch (error) {
      log.error('Failed to load history:', error)
      setEntries([])
    }
    setIsLoading(false)
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

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      if (clearAllTimerRef.current) clearTimeout(clearAllTimerRef.current)
      if (clearRangeTimerRef.current) clearTimeout(clearRangeTimerRef.current)
    }
  }, [])

  const handleDelete = async (id: string) => {
    if (pendingDeleteId === id) {
      const result = await window.electron.history.delete(id)
      if (result.success) {
        loadHistory()
      }
      setPendingDeleteId(null)
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    } else {
      setPendingDeleteId(id)
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = setTimeout(() => setPendingDeleteId(null), UI_NOTIFICATION_TIMEOUT_MS)
    }
  }

  const handleClearAll = async () => {
    if (pendingClearAll) {
      const result = await window.electron.history.clear()
      if (result.success) {
        loadHistory()
      }
      setPendingClearAll(false)
      if (clearAllTimerRef.current) clearTimeout(clearAllTimerRef.current)
    } else {
      setPendingClearAll(true)
      if (clearAllTimerRef.current) clearTimeout(clearAllTimerRef.current)
      clearAllTimerRef.current = setTimeout(() => setPendingClearAll(false), UI_NOTIFICATION_TIMEOUT_MS)
    }
  }

  const handleClearTimeRange = async (range: 'hour' | 'day' | 'week') => {
    if (pendingClearRange === range) {
      const now = Date.now()
      const start = new Date(now)

      if (range === 'hour') {
        start.setHours(start.getHours() - 1)
      } else if (range === 'day') {
        start.setDate(start.getDate() - 1)
      } else {
        start.setDate(start.getDate() - 7)
      }

      const entriesToDelete = await window.electron.history.getByDate(start.getTime(), now)
      await Promise.all(entriesToDelete.map((entry) => window.electron.history.delete(entry.id)))

      loadHistory()
      setPendingClearRange(null)
      if (clearRangeTimerRef.current) clearTimeout(clearRangeTimerRef.current)
    } else {
      setPendingClearRange(range)
      if (clearRangeTimerRef.current) clearTimeout(clearRangeTimerRef.current)
      clearRangeTimerRef.current = setTimeout(() => setPendingClearRange(null), UI_NOTIFICATION_TIMEOUT_MS)
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

    // Less than 1 minute
    if (diff < 60000) {
      return t('history.timeFormat.justNow')
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000)
      return t('history.timeFormat.minuteAgo', { count: minutes })
    }

    // Less than 1 day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000)
      return t('history.timeFormat.hourAgo', { count: hours })
    }

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString(i18n.language, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    // Different year
    return date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  // Group entries by date (memoized to avoid recalculation on every render)
  const groupedEntries = useMemo(() => {
    return entries.reduce(
      (groups, entry) => {
        const date = new Date(entry.visitedAt)
        // Use ISO date string as a stable locale-independent key for grouping
        const dateKey = date.toISOString().slice(0, 10)
        const displayLabel = date.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })

        if (!groups[dateKey]) {
          groups[dateKey] = { label: displayLabel, entries: [] }
        }
        groups[dateKey].entries.push(entry)

        return groups
      },
      {} as Record<string, { label: string; entries: HistoryEntry[] }>
    )
  }, [entries, i18n.language])

  return (
    <ErrorBoundary>
      <div className="p-8 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <History className="w-8 h-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">{t('history.title')}</h1>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-8 py-4 border-b border-border mb-6">
          <div className="flex flex-wrap gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('history.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-border rounded-full focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
              />
            </div>

            {/* Time filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <select
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
                className="px-3 py-2 border border-border rounded-full focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
              >
                <option value="all">{t('history.filters.all')}</option>
                <option value="today">{t('history.filters.today')}</option>
                <option value="week">{t('history.filters.thisWeek')}</option>
                <option value="month">{t('history.filters.thisMonth')}</option>
              </select>
            </div>

            {/* Clear options */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleClearTimeRange('hour')}
                className={`px-3 py-2 text-sm border border-border rounded-full transition-colors text-foreground flex items-center gap-1 ${
                  pendingClearRange === 'hour' ? 'bg-destructive/20' : 'hover:bg-surface-hover'
                }`}
              >
                {pendingClearRange === 'hour' && <TriangleAlert className="w-3 h-3 text-destructive" />}
                {t('history.actions.clearLastHour')}
              </button>
              <button
                onClick={() => handleClearTimeRange('day')}
                className={`px-3 py-2 text-sm border border-border rounded-full transition-colors text-foreground flex items-center gap-1 ${
                  pendingClearRange === 'day' ? 'bg-destructive/20' : 'hover:bg-surface-hover'
                }`}
              >
                {pendingClearRange === 'day' && <TriangleAlert className="w-3 h-3 text-destructive" />}
                {t('history.actions.clearLastDay')}
              </button>
              <button
                onClick={handleClearAll}
                className={`px-3 py-2 text-sm rounded-full transition-colors flex items-center gap-2 ${
                  pendingClearAll
                    ? 'bg-destructive/20 text-destructive border border-destructive/50'
                    : 'bg-destructive text-white hover:bg-destructive/90'
                }`}
              >
                {pendingClearAll ? <TriangleAlert className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                {t('history.actions.clearAll')}
              </button>
            </div>
          </div>
        </div>

        {/* History list */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Lottie animationData={explorerAnimation} className="w-32 h-32 mb-4" loop autoplay />
            <p className="text-muted-foreground">{t('history.loading')}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Lottie animationData={explorerAnimation} className="w-40 h-40 mb-6" loop autoplay />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {query ? t('history.empty.noResults') : t('history.empty.title')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {query ? t('history.empty.tryDifferent') : t('history.empty.description')}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedEntries).map(([dateKey, { label, entries: dateEntries }]) => (
              <div key={dateKey}>
                {/* Date header */}
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-2">{label}</h2>

                {/* Entries for this date */}
                <div className="glass-card divide-y divide-border overflow-hidden">
                  {dateEntries.map((entry, index) => (
                    <div
                      key={entry.id}
                      className={`p-4 hover:bg-surface-hover transition-colors group ${
                        index === 0 ? 'rounded-t-2xl' : ''
                      } ${index === dateEntries.length - 1 ? 'rounded-b-2xl' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        {entry.favicon ? (
                          <img src={entry.favicon} alt="" className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <button
                              onClick={() => openInNewTab(entry.url)}
                              className="font-medium text-primary hover:text-primary/80 truncate text-left"
                            >
                              {entry.title || entry.url}
                            </button>
                            {entry.visitCount > 1 && (
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {t('history.visitsCount', { count: entry.visitCount })}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{entry.url}</div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted-foreground">{formatDate(entry.visitedAt)}</span>

                          {/* Actions */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openInNewTab(entry.url)}
                              className="p-2 hover:bg-surface-active rounded-full transition-colors"
                              title={t('history.actions.openInNewTab')}
                            >
                              <ExternalLink className="w-4 h-4 text-foreground" />
                            </button>
                            <button
                              onClick={() => copyUrl(entry.url, entry.id)}
                              className="p-2 hover:bg-surface-active rounded-full transition-colors relative"
                              title={t('history.actions.copyUrl')}
                            >
                              {copiedId === entry.id ? (
                                <span className="text-xs text-success font-medium whitespace-nowrap">
                                  {t('history.copied')}
                                </span>
                              ) : (
                                <svg
                                  className="w-4 h-4 text-foreground"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                  />
                                </svg>
                              )}
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className={`p-2 rounded-full transition-colors ${
                                pendingDeleteId === entry.id ? 'bg-destructive/20' : 'hover:bg-destructive/10'
                              }`}
                              title={t('history.actions.delete')}
                            >
                              {pendingDeleteId === entry.id ? (
                                <TriangleAlert className="w-4 h-4 text-destructive" />
                              ) : (
                                <Trash2 className="w-4 h-4 text-destructive" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
