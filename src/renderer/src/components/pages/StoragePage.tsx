/**
 * Storage page - TON Storage management.
 * Add, remove, pause, and monitor bags.
 */

import { useState, useEffect, useCallback, memo } from 'react'
import { createLogger } from '@/logger'
import { Plus, Search, HardDrive, X, Settings, Upload, Folder, Copy, FileText } from 'lucide-react'

const log = createLogger('storage')
import { useTranslation } from 'react-i18next'
import type { StorageBag, BagDetails } from '@shared/types'
import { IPC_CHANNELS } from '@shared/ipc-channels'
import { cn } from '@/lib/utils'
import { useTabsStore } from '@/stores/tabs'
import { usePreferencesStore } from '@/stores/preferences'
import { formatBytes } from '@/lib/format'
import { BagDetailPanel } from './storage/BagDetailPanel'
import { AddBagModal } from './storage/AddBagModal'
import tonIcon from '@/assets/ton.svg'

type FilterType = 'all' | 'downloading' | 'complete'

export function StoragePage() {
  const { t } = useTranslation('pages')
  const [bags, setBags] = useState<StorageBag[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBag, setSelectedBag] = useState<StorageBag | null>(null)
  const [bagDetails, setBagDetails] = useState<BagDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'files'>('info')
  const [showAddModal, setShowAddModal] = useState(false)

  const loadBags = useCallback(async () => {
    try {
      const result = await window.electron.storage.listBags()
      if (result.success) {
        setBags(result.bags as StorageBag[])
      }
    } catch (err) {
      log.error('Failed to load bags:', err)
    }
  }, [])

  // Load bags on mount and listen for real-time updates
  useEffect(() => {
    loadBags()

    const unsubscribe = window.electron.on(IPC_CHANNELS.STORAGE_BAGS_UPDATED, (...args: unknown[]) => {
      const updatedBags = args[0] as StorageBag[]
      setBags(updatedBags)
    })

    return () => {
      unsubscribe()
    }
  }, [loadBags])

  const handleRemoveBag = useCallback(
    async (bagId: string) => {
      try {
        await window.electron.storage.removeBag(bagId)
        await loadBags()
        if (selectedBag?.id === bagId) {
          setSelectedBag(null)
          setBagDetails(null)
        }
      } catch (err) {
        log.error('Failed to remove bag:', err)
      }
    },
    [loadBags, selectedBag]
  )

  const loadBagDetails = useCallback(async (bagId: string) => {
    setLoadingDetails(true)
    try {
      const result = await window.electron.storage.getBagDetails(bagId)
      if (result.success && result.details) {
        setBagDetails(result.details)
      } else {
        setBagDetails(null)
      }
    } catch (err) {
      log.error('Failed to load bag details:', err)
      setBagDetails(null)
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  const handleSelectBag = useCallback(
    (bag: StorageBag) => {
      setSelectedBag(bag)
      setBagDetails(null)
      loadBagDetails(bag.id)
    },
    [loadBagDetails]
  )

  const handleOpenFolder = useCallback(async (bagId: string) => {
    const result = await window.electron.storage.openFolder(bagId)
    if (!result.success) {
      log.error('Failed to open folder:', result.error)
    }
  }, [])

  const handleBrowseFiles = useCallback((bagId: string) => {
    useTabsStore.getState().addTab(`ton://storage/browse/${bagId}`)
  }, [])

  const handleShowFile = async (bagId: string, fileName: string) => {
    const result = await window.electron.storage.showFile(bagId, fileName)
    if (!result.success) {
      log.error('Failed to show file:', result.error)
    }
  }

  const navigateToSettings = () => {
    useTabsStore.getState().navigateActiveTab('ton://settings')
  }

  // Filter bags
  const isComplete = (bag: StorageBag) => bag.size > 0 && bag.downloaded >= bag.size
  const filteredBags = bags.filter((bag) => {
    if (filter === 'downloading' && bag.status !== 'downloading') return false
    if (filter === 'complete' && !isComplete(bag)) return false

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return bag.name.toLowerCase().includes(query) || bag.id.toLowerCase().includes(query)
    }
    return true
  })

  const counts = {
    all: bags.length,
    downloading: bags.filter((b) => b.status === 'downloading').length,
    complete: bags.filter(isComplete).length,
  }

  const handleCopyBagId = useCallback(async (bagId: string) => {
    try {
      await navigator.clipboard.writeText(bagId)
    } catch (err) {
      log.error('Failed to copy bag ID:', err)
    }
  }, [])

  return (
    <div className="flex h-full bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Sidebar */}
      <div className="w-56 border-r border-border p-4 flex flex-col bg-[hsl(var(--elevation-1))]">
        <h2 className="text-foreground text-xl font-bold mb-4 flex items-center justify-center gap-2">
          <img src={tonIcon} alt="" className="h-5 w-5" />
          {t('storage.title')}
        </h2>

        <button
          onClick={() => setShowAddModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors bg-accent/60 text-foreground hover:bg-accent/80"
        >
          <Plus className="h-4 w-4" />
          {t('storage.actions.addBag')}
        </button>

        {/* Filters */}
        <div className="space-y-2 mb-6 mt-4">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')} count={counts.all}>
            {t('storage.filters.all')}
          </FilterButton>
          <FilterButton
            active={filter === 'downloading'}
            onClick={() => setFilter('downloading')}
            count={counts.downloading}
          >
            {t('storage.filters.downloading')}
          </FilterButton>
          <FilterButton active={filter === 'complete'} onClick={() => setFilter('complete')} count={counts.complete}>
            {t('storage.filters.complete')}
          </FilterButton>
        </div>

        {/* Seeding toggle + Settings at bottom */}
        <div className="mt-auto space-y-2">
          <SeedingToggle />
          <button
            onClick={navigateToSettings}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-accent/40"
          >
            <Settings className="h-4 w-4" />
            {t('storage.actions.settings')}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search Bar */}
        <div className="p-4 border-b border-border flex justify-end">
          <div className="w-64 flex items-center rounded-md px-3 bg-[hsl(var(--elevation-2))]">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('storage.searchBags')}
              className="flex-1 bg-transparent border-none py-2.5 px-3 text-foreground text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {filteredBags.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <HardDrive className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg mb-2">{t('storage.empty.title')}</p>
              <p className="text-sm">{t('storage.empty.description')}</p>
            </div>
          ) : (
            <div className="p-4">
              <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                <thead>
                  <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider bg-[hsl(var(--elevation-2))]">
                    <th className="px-4 py-3 font-medium rounded-l-md">{t('storage.table.name')}</th>
                    <th className="px-4 py-3 font-medium w-24">{t('storage.table.size')}</th>
                    <th className="px-4 py-3 font-medium w-40">{t('storage.table.progress')}</th>
                    <th className="px-4 py-3 font-medium w-28">{t('storage.table.status')}</th>
                    <th className="px-4 py-3 font-medium w-20">{t('storage.table.peers')}</th>
                    <th className="px-4 py-3 font-medium w-20">{t('storage.table.files')}</th>
                    <th className="px-4 py-3 font-medium w-40 rounded-r-md"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBags.map((bag) => (
                    <BagRow
                      key={bag.id}
                      bag={bag}
                      selected={selectedBag?.id === bag.id}
                      onClick={handleSelectBag}
                      onRemove={handleRemoveBag}
                      onBrowseFiles={handleBrowseFiles}
                      onOpenFolder={handleOpenFolder}
                      onCopyId={handleCopyBagId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedBag && (
          <BagDetailPanel
            bag={selectedBag}
            bagDetails={bagDetails}
            loadingDetails={loadingDetails}
            detailTab={detailTab}
            onTabChange={setDetailTab}
            onOpenFolder={handleOpenFolder}
            onBrowseFiles={handleBrowseFiles}
            onShowFile={handleShowFile}
          />
        )}
      </div>

      {/* Add Bag Modal */}
      <AddBagModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onBagAdded={loadBags} />
    </div>
  )
}

// Seeding Toggle Component
function SeedingToggle() {
  const { t } = useTranslation('pages')
  const seedingEnabled = usePreferencesStore((s) => s.draft.seedingEnabled)
  const setDraft = usePreferencesStore((s) => s.setDraft)
  const save = usePreferencesStore((s) => s.save)

  const handleToggle = async (enabled: boolean) => {
    setDraft('seedingEnabled', enabled)
    await save()
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Upload className="h-4 w-4" />
        <span>{t('storage.actions.seeding')}</span>
      </div>
      <button
        onClick={() => handleToggle(!seedingEnabled)}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors duration-200',
          seedingEnabled ? 'bg-primary' : 'bg-muted'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200',
            seedingEnabled && 'translate-x-4'
          )}
        />
      </button>
    </div>
  )
}

// Filter Button Component
function FilterButton({
  children,
  active,
  onClick,
  count,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  count: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors',
        active ? 'bg-accent/60 text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
      )}
    >
      <span className={active ? '' : 'text-muted-foreground'}>{children}</span>
      <span
        className={cn(
          'inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-md text-xs font-medium',
          active ? 'bg-foreground/10 text-foreground' : 'bg-accent/40 text-muted-foreground'
        )}
      >
        {count}
      </span>
    </button>
  )
}

// Bag Row Component
const BagRow = memo(function BagRow({
  bag,
  selected,
  onClick,
  onRemove,
  onBrowseFiles,
  onOpenFolder,
  onCopyId,
}: {
  bag: StorageBag
  selected: boolean
  onClick: (bag: StorageBag) => void
  onRemove: (bagId: string) => void
  onBrowseFiles: (bagId: string) => void
  onOpenFolder: (bagId: string) => void
  onCopyId: (bagId: string) => void
}) {
  const { t } = useTranslation('pages')
  const progress = bag.size > 0 ? (bag.downloaded / bag.size) * 100 : 0

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <tr
      onClick={() => onClick(bag)}
      className={cn(
        'group cursor-pointer transition-colors rounded-md',
        selected ? 'bg-accent/60' : 'bg-foreground/[0.03] hover:bg-accent/40'
      )}
    >
      <td className="px-4 py-3 rounded-l-md">
        <span className="text-foreground text-sm font-medium">{bag.name}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-muted-foreground text-sm">{formatBytes(bag.size)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 rounded-md overflow-hidden bg-accent/40">
            <div
              className="h-full rounded-md transition-all duration-300 bg-primary/70"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground w-10">{Math.round(progress)}%</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={bag.status} />
      </td>
      <td className="px-4 py-3">
        <span className="text-muted-foreground text-sm tabular-nums">{bag.peers}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-muted-foreground text-sm">{bag.filesCount ?? '-'}</span>
      </td>
      <td className="px-4 py-3 rounded-r-md">
        <div className="flex items-center justify-end gap-1">
          <RowAction
            label={t('storage.actions.browseFiles')}
            onClick={stop(() => onBrowseFiles(bag.id))}
            icon={<FileText className="h-4 w-4" />}
          />
          <RowAction
            label={t('storage.actions.openFolder')}
            onClick={stop(() => onOpenFolder(bag.id))}
            icon={<Folder className="h-4 w-4" />}
          />
          <RowAction
            label={t('storage.actions.copyBagId')}
            onClick={stop(() => onCopyId(bag.id))}
            icon={<Copy className="h-4 w-4" />}
          />
          <button
            onClick={stop(() => onRemove(bag.id))}
            title={t('storage.actions.remove')}
            className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded-md hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  )
})

// Hover-revealed row action button
function RowAction({
  label,
  onClick,
  icon,
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent/40 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
    >
      {icon}
    </button>
  )
}

// Status Badge Component
function StatusBadge({ status }: { status: StorageBag['status'] }) {
  const { t } = useTranslation('pages')
  const config = {
    downloading: { className: 'text-primary', label: t('storage.status.downloading') },
    seeding: { className: 'text-primary', label: t('storage.status.completed') },
    paused: { className: 'text-muted-foreground', label: t('storage.status.paused') },
    error: { className: 'text-destructive', label: t('storage.status.error') },
  }

  const { className, label } = config[status]

  return <span className={cn('text-xs', className)}>{label}</span>
}
