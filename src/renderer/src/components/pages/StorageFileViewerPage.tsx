/**
 * In-app tabular file viewer at ton://storage/view/<bag>/<path>.
 *
 * Reads a CSV/TSV/JSONL file from a bag and renders it as a real table instead
 * of dumping raw text. The grid is virtualised (only visible rows are in the
 * DOM) so it stays fluid on large files with no row cap. Parsing lives in
 * ./storage/table-data so it stays shared and tested.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, FileSpreadsheet, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createLogger } from '@/logger'
import { useTabsStore } from '@/stores/tabs'
import { EmptyState } from '@/components/ui/ios/EmptyState'
import { parseTable, type TableData } from './storage/table-data'

const log = createLogger('storage-view')

const ROW_H = 32
const HEADER_H = 36
const INDEX_W = 56
const OVERSCAN = 8

/** Estimate a stable per-column pixel width from the header + a row sample. */
function columnWidths(table: TableData): number[] {
  const SAMPLE = 200
  const n = Math.min(table.rows.length, SAMPLE)
  return table.columns.map((col, c) => {
    let maxLen = col.length
    for (let r = 0; r < n; r++) {
      const v = table.rows[r][c]
      if (v && v.length > maxLen) maxLen = v.length
    }
    return Math.min(360, Math.max(96, Math.round(maxLen * 7.2) + 24))
  })
}

export function StorageFileViewerPage({ bagId, filePath }: { bagId: string; filePath: string }) {
  const { t } = useTranslation('pages')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)

  const fileName = filePath.split('/').pop() || filePath

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setText(null)
    setScrollTop(0)
    window.electron.storage
      .readFile(bagId, filePath)
      .then((res) => {
        if (cancelled) return
        if (res.success && typeof res.content === 'string') {
          setText(res.content)
        } else {
          setError(res.error || t('storage.view.readFailed', { defaultValue: 'Could not read file' }))
        }
      })
      .catch((err) => {
        if (cancelled) return
        log.error('Failed to read file:', err)
        setError(t('storage.view.readFailed', { defaultValue: 'Could not read file' }))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [bagId, filePath, t])

  // No row cap: parse everything and window the rows on scroll.
  const table = useMemo<TableData | null>(
    () => (text !== null ? parseTable(fileName, text, Number.POSITIVE_INFINITY) : null),
    [text, fileName]
  )
  const widths = useMemo(() => (table ? columnWidths(table) : []), [table])
  const totalWidth = INDEX_W + widths.reduce((a, b) => a + b, 0)

  // Track the scroll viewport height so the visible window is sized correctly.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])

  const openRaw = () => {
    useTabsStore.getState().navigateActiveTab(`ton://storage/file/${bagId}/${encodeURIComponent(filePath)}`)
  }
  const backToFiles = () => {
    useTabsStore.getState().navigateActiveTab(`ton://storage/browse/${bagId}`)
  }

  const rows = table?.rows ?? []
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
  const visible: number[] = []
  for (let i = start; i < end; i++) visible.push(i)

  return (
    <div className="flex h-full flex-col bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-3">
        <button
          type="button"
          onClick={backToFiles}
          title={t('storage.view.backToFiles', { defaultValue: 'Back to files' })}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
        <FileSpreadsheet className="h-[18px] w-[18px] shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground" title={fileName}>
            {fileName}
          </h1>
          {table && (
            <p className="text-[12px] text-muted-foreground">
              {t('storage.view.shape', {
                rows: table.rows.length,
                cols: table.columns.length,
                defaultValue: '{{rows}} rows · {{cols}} cols',
              })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={openRaw}
          className="flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('storage.view.openRaw', { defaultValue: 'Open raw' })}
        </button>
      </header>

      {/* Body */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('storage.view.loading', { defaultValue: 'Loading' })}
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            title={t('storage.view.readFailed', { defaultValue: 'Could not read file' })}
            description={error}
          />
        </div>
      ) : !table || table.columns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<FileSpreadsheet className="h-7 w-7" />}
            title={t('storage.view.empty', { defaultValue: 'Nothing to show' })}
            description={t('storage.view.emptyHint', { defaultValue: 'This file has no table rows to display.' })}
          />
        </div>
      ) : (
        <div ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} className="flex-1 overflow-auto">
          <div style={{ width: totalWidth, minWidth: '100%' }} className="text-[13px]">
            {/* Sticky header row */}
            <div
              className="sticky top-0 z-10 flex bg-background-secondary"
              style={{ height: HEADER_H, width: totalWidth }}
            >
              <div className="shrink-0 border-b border-border-subtle" style={{ width: INDEX_W }} />
              {table.columns.map((col, c) => (
                <div
                  key={c}
                  style={{ width: widths[c] }}
                  className="flex shrink-0 items-center truncate border-b border-border-subtle px-3 font-semibold text-foreground"
                  title={col}
                >
                  {col}
                </div>
              ))}
            </div>

            {/* Virtualised body: only `visible` rows are rendered */}
            <div style={{ height: rows.length * ROW_H, position: 'relative', width: totalWidth }}>
              {visible.map((i) => (
                <div
                  key={i}
                  className="absolute left-0 flex border-b border-border-subtle/60 hover:bg-surface-hover"
                  style={{ top: i * ROW_H, height: ROW_H, width: totalWidth }}
                >
                  <div
                    className="flex shrink-0 items-center justify-end px-2 font-mono text-[11px] text-muted-foreground/50 tabular-nums"
                    style={{ width: INDEX_W }}
                  >
                    {i + 1}
                  </div>
                  {table.columns.map((_, c) => (
                    <div
                      key={c}
                      style={{ width: widths[c] }}
                      className="flex shrink-0 items-center truncate px-3 font-mono text-foreground"
                      title={rows[i][c] ?? ''}
                    >
                      <span className="truncate">{rows[i][c] ?? ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
