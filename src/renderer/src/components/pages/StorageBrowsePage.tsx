/**
 * In-app TON Storage file browser at ton://storage/browse/<bagId>.
 *
 * Master-detail iOS layout: floating sidebar listing all bags on the left,
 * a full file browser (header + breadcrumb + sortable list with virtual
 * folders) for the selected bag on the right. Pure tree/sort logic lives in
 * ./storage/bag-files so it stays shared and tested.
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import {
  Search,
  Copy,
  Check,
  Folder,
  File,
  Music,
  Film,
  Image as ImageIcon,
  FileText,
  FileArchive,
  FileCode2,
  ArrowUp,
  ArrowDown,
  Loader2,
  HardDrive,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { StorageBag, BagDetails } from '@shared/types'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { UI_COPY_FEEDBACK_MS } from '@shared/constants'
import { cn } from '@/lib/utils'
import { createLogger } from '@/logger'
import { useTabsStore } from '@/stores/tabs'
import { formatBytes } from '@/lib/format'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { EmptyState } from '@/components/ui/ios/EmptyState'
import {
  buildEntries,
  sortEntries,
  breadcrumbs,
  entryStats,
  normalizePath,
  type Entry,
  type FileCategory,
  type SortField,
} from './storage/bag-files'
import { isTabularFile } from './storage/table-data'

const log = createLogger('storage-browse')

const CATEGORY_ICON: Record<FileCategory, typeof File> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
  document: FileText,
  archive: FileArchive,
  code: FileCode2,
  text: FileText,
  folder: Folder,
  other: File,
}

export function StorageBrowsePage({ bagId }: { bagId: string }) {
  const { t } = useTranslation('pages')
  const [bags, setBags] = useState<StorageBag[]>([])
  const [selectedId, setSelectedId] = useState(bagId)
  const [details, setDetails] = useState<BagDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentPath, setCurrentPath] = useState('/')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [query, setQuery] = useState('')

  // Keep selection in sync if the tab is re-navigated to a different bag.
  useEffect(() => {
    setSelectedId(bagId)
  }, [bagId])

  const loadBags = useCallback(async () => {
    try {
      const result = await window.electron.storage.listBags()
      if (result.success) setBags(result.bags as StorageBag[])
    } catch (err) {
      log.error('Failed to load bags:', err)
    }
  }, [])

  useEffect(() => {
    loadBags()
    const unsubscribe = window.electron.on(IPC_CHANNELS.STORAGE_BAGS_UPDATED, (updated) => setBags(updated))
    return () => unsubscribe()
  }, [loadBags])

  // Load details whenever the selected bag changes; reset folder + sort.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDetails(null)
    setCurrentPath('/')
    window.electron.storage
      .getBagDetails(selectedId)
      .then((result) => {
        if (cancelled) return
        setDetails(result.success && result.details ? result.details : null)
      })
      .catch((err) => {
        if (cancelled) return
        log.error('Failed to load bag details:', err)
        setDetails(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const selectedBag = bags.find((b) => b.id === selectedId) ?? null
  const bagName = selectedBag?.name || details?.dir_name || t('storage.browse.bag', { defaultValue: 'Bag' })

  const entries = useMemo(() => {
    if (!details) return [] as Entry[]
    const built = buildEntries(details.files, currentPath)
    const filtered = query.trim()
      ? built.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()))
      : built
    return sortEntries(filtered, sortField, sortAsc)
  }, [details, currentPath, query, sortField, sortAsc])

  const total = useMemo(
    () => (details ? entryStats(buildEntries(details.files, '/')) : { fileCount: 0, totalSize: 0 }),
    [details]
  )

  const crumbs = breadcrumbs(currentPath)

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((v) => !v)
    else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  // Open the file in a new tab: CSV/JSONL get the in-app table viewer, the rest
  // render inline in the browser (audio/pdf/image).
  const openFile = (fullPath: string) => {
    const kind = isTabularFile(fullPath) ? 'view' : 'file'
    useTabsStore.getState().addTab(`ton://storage/${kind}/${selectedId}/${encodeURIComponent(fullPath)}`)
  }

  return (
    <div className="flex h-full bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Floating sidebar: bag list */}
      <aside className="m-3 flex w-[260px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h1 className="text-[15px] font-semibold text-foreground">
            {t('storage.bagsTitle', { defaultValue: 'Bags' })}
          </h1>
          <span className="text-[13px] font-medium text-muted-foreground tabular-nums">{bags.length}</span>
        </div>
        <nav className="flex-1 overflow-auto px-2 pb-2">
          {bags.map((b) => (
            <BagItem key={b.id} bag={b} selected={b.id === selectedId} onSelect={() => setSelectedId(b.id)} />
          ))}
        </nav>
      </aside>

      {/* Main: file browser */}
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('storage.loadingFiles')}
          </div>
        ) : !details ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<HardDrive className="h-7 w-7" />}
              title={t('storage.browse.notFound', { defaultValue: 'Bag not available' })}
              description={t('storage.browse.notFoundHint', {
                defaultValue: 'This bag is not in your storage. Add it from the Storage page to browse its files.',
              })}
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-6 py-5">
            {/* Header: name + full copyable bag id + meta */}
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-foreground" title={bagName}>
                {bagName}
              </h2>
              <CopyableBagId id={selectedId} />
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {t('storage.browse.fileCount', { count: total.fileCount, defaultValue: '{{count}} files' })} ·{' '}
                {formatBytes(total.totalSize)}
              </p>
            </div>

            {/* Search */}
            <div className="mb-4 flex h-9 items-center gap-2 rounded-full bg-surface px-3.5">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('storage.browse.searchFiles', { defaultValue: 'Search files' })}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>

            {/* Breadcrumb */}
            <div className="mb-2 flex flex-wrap items-center gap-1 px-1 text-[13px]">
              {crumbs.map((c, i) => (
                <span key={c.path} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground/60">/</span>}
                  {i === crumbs.length - 1 ? (
                    <span className="text-muted-foreground">{c.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCurrentPath(c.path)}
                      className="text-primary hover:underline"
                    >
                      {c.name}
                    </button>
                  )}
                </span>
              ))}
            </div>

            {/* File list */}
            {entries.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {query.trim()
                  ? t('storage.browse.noMatch', { defaultValue: 'No matching files' })
                  : t('storage.noFiles')}
              </p>
            ) : (
              <InsetGroup>
                <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2">
                  <span className="w-[26px]" />
                  <SortHeader
                    label={t('storage.table.name', { defaultValue: 'Name' })}
                    active={sortField === 'name'}
                    asc={sortAsc}
                    onClick={() => toggleSort('name')}
                    className="flex-1"
                  />
                  <SortHeader
                    label={t('storage.table.size', { defaultValue: 'Size' })}
                    active={sortField === 'size'}
                    asc={sortAsc}
                    onClick={() => toggleSort('size')}
                    className="w-24 justify-end"
                  />
                </div>
                {entries.map((e) => (
                  <FileEntryRow
                    key={e.kind === 'file' ? e.fullPath : `dir:${e.name}`}
                    entry={e}
                    onOpenFolder={() => setCurrentPath(normalizePath(currentPath + e.name))}
                    onOpenFile={(fp) => openFile(fp)}
                  />
                ))}
              </InsetGroup>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

const BagItem = memo(function BagItem({
  bag,
  selected,
  onSelect,
}: {
  bag: StorageBag
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-3 py-2 text-left transition-colors',
        selected ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-foreground">{bag.name}</span>
        <span className="block truncate text-[12px] text-muted-foreground">{formatBytes(bag.size)}</span>
      </div>
    </button>
  )
})

function SortHeader({
  label,
  active,
  asc,
  onClick,
  className,
}: {
  label: string
  active: boolean
  asc: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground',
        className
      )}
    >
      {label}
      {active && (asc ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />)}
    </button>
  )
}

const FileEntryRow = memo(function FileEntryRow({
  entry,
  onOpenFolder,
  onOpenFile,
}: {
  entry: Entry
  onOpenFolder: () => void
  onOpenFile: (fullPath: string) => void
}) {
  const isFolder = entry.kind === 'folder'
  const Icon = isFolder ? Folder : CATEGORY_ICON[entry.category]
  return (
    <button
      type="button"
      onClick={() => (isFolder ? onOpenFolder() : onOpenFile(entry.fullPath))}
      className="flex w-full items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-hover"
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', isFolder ? 'text-primary' : 'text-muted-foreground')} />
      <span
        className={cn('min-w-0 flex-1 truncate text-sm', isFolder ? 'font-medium text-foreground' : 'text-foreground')}
      >
        {entry.name}
        {isFolder && '/'}
      </span>
      <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
        {formatBytes(entry.size)}
      </span>
    </button>
  )
})

function CopyableBagId({ id }: { id: string }): ReactNode {
  const { t } = useTranslation('pages')
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), UI_COPY_FEEDBACK_MS)
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={t('storage.actions.copyBagId')}
      className="mt-1 flex max-w-full items-start gap-1.5 text-left font-mono text-[11px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="break-all">{id}</span>
      {copied ? <Check className="mt-px h-3 w-3 shrink-0 text-success" /> : <Copy className="mt-px h-3 w-3 shrink-0" />}
    </button>
  )
}
