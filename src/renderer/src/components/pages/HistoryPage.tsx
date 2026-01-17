/**
 * History Page - ton://history
 * Display and manage browsing history with 2 privacy modes.
 */

import { useState, useEffect } from 'react'
import { Search, Trash2, Clock, ExternalLink, Filter, History, Lock, Zap } from 'lucide-react'
import { useTabsStore } from '../../stores/tabs'
import Lottie from 'lottie-react'
import explorerAnimation from '@/assets/explorer.json'
import { usePreferences } from '@/stores/preferences'

interface HistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
  visitCount: number
  favicon?: string
}

interface HistoryStats {
  total: number
  mode: string
  oldestEntry?: number
  newestEntry?: number
  isLocked: boolean
}

type TimeFilter = 'today' | 'week' | 'month' | 'all'

export function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [stats, setStats] = useState<HistoryStats | null>(null)
  const [query, setQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const addTab = useTabsStore(state => state.addTab)
  const { theme } = usePreferences()

  useEffect(() => {
    // Debounce search
    const timeoutId = setTimeout(() => {
      loadHistory()
      loadStats()
    }, query ? 300 : 0) // Only debounce for search, not for filter changes

    return () => clearTimeout(timeoutId)
  }, [query, timeFilter])

  const loadHistory = async () => {
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
      console.error('Failed to load history:', error)
      setEntries([])
    }
    setIsLoading(false)
  }

  const loadStats = async () => {
    try {
      const s = await window.electron.history.getStats()
      setStats(s)
    } catch (error) {
      console.error('Failed to load stats:', error)
    }
  }

  const handleDelete = async (id: string) => {
    const result = await window.electron.history.delete(id)
    if (result.success) {
      loadHistory()
      loadStats()
    }
  }

  const handleClearAll = async () => {
    if (!confirm('Clear all history? This action is irreversible.')) {
      return
    }

    const result = await window.electron.history.clear()
    if (result.success) {
      loadHistory()
      loadStats()
    }
  }

  const handleClearTimeRange = async (range: 'hour' | 'day' | 'week') => {
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

    if (!confirm(`Clear ${entriesToDelete.length} entr${entriesToDelete.length > 1 ? 'ies' : 'y'} from the last ${range === 'hour' ? 'hour' : range === 'day' ? 'day' : 'week'}?`)) {
      return
    }

    for (const entry of entriesToDelete) {
      await window.electron.history.delete(entry.id)
    }

    loadHistory()
    loadStats()
  }

  const openInNewTab = (url: string) => {
    addTab(url)
  }

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    // Less than 1 minute
    if (diff < 60000) {
      return 'Just now'
    }

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000)
      return `${minutes} min ago`
    }

    // Less than 1 day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000)
      return `${hours}h ago`
    }

    // Same year
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    // Different year
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'memory': return 'Live'
      case 'persistent': return 'Persistent (Encrypted)'
      default: return mode
    }
  }

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'memory': return 'text-primary'
      case 'persistent': return 'text-green-600'
      default: return 'text-muted-foreground'
    }
  }

  // Group entries by date
  const groupedEntries = entries.reduce((groups, entry) => {
    const date = new Date(entry.visitedAt)
    const dateKey = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    if (!groups[dateKey]) {
      groups[dateKey] = []
    }
    groups[dateKey].push(entry)

    return groups
  }, {} as Record<string, HistoryEntry[]>)

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <History className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">Browsing History</h1>
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
              placeholder="Search history..."
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
              <option value="all">All history</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          </div>

          {/* Clear options */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleClearTimeRange('hour')}
              className="px-3 py-2 text-sm border border-border rounded-full hover:bg-surface-hover transition-colors text-foreground"
            >
              Clear last hour
            </button>
            <button
              onClick={() => handleClearTimeRange('day')}
              className="px-3 py-2 text-sm border border-border rounded-full hover:bg-surface-hover transition-colors text-foreground"
            >
              Clear last day
            </button>
            <button
              onClick={handleClearAll}
              className="px-3 py-2 text-sm bg-destructive text-white rounded-full hover:bg-destructive/90 transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Clear all
            </button>
          </div>
        </div>
      </div>

      {/* History list */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Lottie animationData={explorerAnimation} className="w-32 h-32 mb-4" loop autoplay />
          <p className="text-muted-foreground">Loading history...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Lottie animationData={explorerAnimation} className="w-40 h-40 mb-6" loop autoplay />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {query ? 'No results found' : 'No history yet'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {query ? 'Try a different search term' : 'Your visited pages will appear here'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedEntries).map(([dateKey, dateEntries]) => (
            <div key={dateKey}>
              {/* Date header */}
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-2">
                {dateKey}
              </h2>

              {/* Entries for this date */}
              <div className="bg-card rounded-2xl border border-border divide-y divide-border overflow-hidden">
                {dateEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={`p-4 hover:bg-surface-hover transition-colors group ${
                      index === 0 ? 'rounded-t-2xl' : ''
                    } ${
                      index === dateEntries.length - 1 ? 'rounded-b-2xl' : ''
                    }`}
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
                              ({entry.visitCount} visits)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {entry.url}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(entry.visitedAt)}
                        </span>

                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openInNewTab(entry.url)}
                            className="p-2 hover:bg-surface-active rounded transition-colors"
                            title="Open in new tab"
                          >
                            <ExternalLink className="w-4 h-4 text-foreground" />
                          </button>
                          <button
                            onClick={() => copyUrl(entry.url, entry.id)}
                            className="p-2 hover:bg-surface-active rounded transition-colors relative"
                            title="Copy URL"
                          >
                            {copiedId === entry.id ? (
                              <span className="text-xs text-green-600 font-medium whitespace-nowrap">Copied!</span>
                            ) : (
                              <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-2 hover:bg-destructive/10 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
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
  )
}
