/**
 * Storage page - TON Storage management.
 * Add, remove, pause, and monitor bags.
 *
 * Layout iOS : sidebar à gauche (filtres, ou détail du bag avec retour),
 * liste compacte à droite.
 */

import { useState, useEffect, useCallback, memo, type PointerEvent, type ReactNode } from 'react'
import { createLogger } from '@/logger'
import { Check, Copy, FolderOpen, HardDrive, Search, Trash2 } from 'lucide-react'

const log = createLogger('storage')
import { useTranslation } from 'react-i18next'
import type { StorageBag, BagDetails } from '@shared/types'
import { storageClient } from '@/features/storage/client'
import { cn } from '@/lib/utils'
import { browserNavigation } from '@/features/browser/navigation'
import { formatBytes } from '@/lib/format'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { EmptyState } from '@/components/ui/ios/EmptyState'
import { StorageSidebar } from './storage/StorageSidebar'
import { filterBags, bagCounts, type FilterType } from './storage/bag-filter'
import { AddBagModal } from './storage/AddBagModal'

export function StoragePage() {
  const { t } = useTranslation('pages')
  const [bags, setBags] = useState<StorageBag[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBagId, setSelectedBagId] = useState<string | null>(null)
  const [bagDetails, setBagDetails] = useState<BagDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'files'>('info')
  const [showAddModal, setShowAddModal] = useState(false)

  const loadBags = useCallback(async () => {
    try {
      const result = await storageClient.listBags()
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

    const unsubscribe = storageClient.onBagsUpdated((updatedBags) => {
      setBags(updatedBags)
    })

    return () => {
      unsubscribe()
    }
  }, [loadBags])

  const handleRemoveBag = useCallback(
    async (bagId: string) => {
      try {
        await storageClient.removeBag(bagId)
        await loadBags()
        if (selectedBagId === bagId) {
          setSelectedBagId(null)
          setBagDetails(null)
        }
      } catch (err) {
        log.error('Failed to remove bag:', err)
      }
    },
    [loadBags, selectedBagId]
  )

  const loadBagDetails = useCallback(async (bagId: string) => {
    setLoadingDetails(true)
    try {
      const result = await storageClient.getBagDetails(bagId)
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

  const handleOpenFolder = useCallback(async (bagId: string) => {
    try {
      await storageClient.openFolder(bagId)
    } catch (error) {
      log.error('Failed to open folder:', error)
    }
  }, [])

  const handleBrowseFiles = useCallback((bagId: string) => {
    browserNavigation.addTab(`ton://storage/browse/${bagId}`)
  }, [])

  const handleSelectBag = useCallback(
    (bag: StorageBag) => {
      if (selectedBagId === bag.id) {
        handleBrowseFiles(bag.id)
        return
      }
      setSelectedBagId(bag.id)
      setBagDetails(null)
      setDetailTab('info')
      loadBagDetails(bag.id)
    },
    [handleBrowseFiles, loadBagDetails, selectedBagId]
  )

  const handleShowFile = async (bagId: string, fileName: string) => {
    try {
      await storageClient.showFile(bagId, fileName)
    } catch (error) {
      log.error('Failed to show file:', error)
    }
  }

  const filteredBags = filterBags(bags, filter, searchQuery)
  const counts = bagCounts(bags)
  const selectedBag = selectedBagId ? (bags.find((b) => b.id === selectedBagId) ?? null) : null

  const handleCopyBagId = useCallback(async (bagId: string) => {
    try {
      await navigator.clipboard.writeText(bagId)
    } catch (err) {
      log.error('Failed to copy bag ID:', err)
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedBagId(null)
    setBagDetails(null)
  }, [])

  const handlePagePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!selectedBagId) return
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-storage-sidebar]')) return
      if (target.closest('[data-bag-row]')) return
      clearSelection()
    },
    [clearSelection, selectedBagId]
  )

  return (
    <div
      className="flex h-full bg-background-secondary"
      style={{ fontFamily: 'Inter, sans-serif' }}
      onPointerDown={handlePagePointerDown}
    >
      {/* Floating detached sidebar */}
      <StorageSidebar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        onAddBag={() => setShowAddModal(true)}
        bag={selectedBag}
        bagDetails={bagDetails}
        loadingDetails={loadingDetails}
        detailTab={detailTab}
        onTabChange={setDetailTab}
        onOpenFolder={handleOpenFolder}
        onBrowseFiles={handleBrowseFiles}
        onShowFile={handleShowFile}
        onCopyId={handleCopyBagId}
        onRemove={handleRemoveBag}
        onBack={clearSelection}
      />

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex items-center justify-between gap-4 px-5 pb-2 pt-4">
          <h2 className="text-[17px] font-semibold text-heading">
            {t('storage.bagsTitle', { defaultValue: 'Bags' })}
            <span className="ml-1.5 font-medium text-muted-foreground tabular-nums">({filteredBags.length})</span>
          </h2>
          <div className="flex w-64 items-center gap-2 rounded-full border border-border-subtle bg-card px-3 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('storage.searchBags')}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="flex-1 px-5 pb-4">
          {filteredBags.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<HardDrive className="h-7 w-7" />}
                title={t('storage.empty.title')}
                description={t('storage.empty.description')}
              />
            </div>
          ) : (
            <InsetGroup bodyClassName="divide-y divide-border-subtle">
              {filteredBags.map((bag) => (
                <BagRow
                  key={bag.id}
                  bag={bag}
                  selected={selectedBag?.id === bag.id}
                  onClick={handleSelectBag}
                  onOpenFolder={handleOpenFolder}
                  onCopyId={handleCopyBagId}
                  onRemove={handleRemoveBag}
                />
              ))}
            </InsetGroup>
          )}
        </div>
      </div>

      {/* Add Bag Modal */}
      <AddBagModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onBagAdded={loadBags} />
    </div>
  )
}

// Bag Row Component — no leading icon; state is carried by the right-side indicator
const BagRow = memo(function BagRow({
  bag,
  selected,
  onClick,
  onOpenFolder,
  onCopyId,
  onRemove,
}: {
  bag: StorageBag
  selected: boolean
  onClick: (bag: StorageBag) => void
  onOpenFolder: (bagId: string) => void
  onCopyId: (bagId: string) => void
  onRemove: (bagId: string) => void
}) {
  const { t } = useTranslation('pages')
  const progress = bag.size > 0 ? Math.min(100, (bag.downloaded / bag.size) * 100) : 0
  const isDownloading = bag.status === 'downloading' && progress < 100

  // Subtitle for non-downloading bags: size · peers · (paused)
  const metaParts = [formatBytes(bag.size)]
  if (bag.peers > 0) metaParts.push(`${bag.peers} ${t('storage.table.peers').toLowerCase()}`)
  if (bag.status === 'paused') metaParts.push(t('storage.status.paused'))

  return (
    <div
      data-bag-row={bag.id}
      onClick={() => onClick(bag)}
      className={cn(
        'group flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors',
        selected ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium leading-tight text-foreground">{bag.name}</span>
        {isDownloading ? (
          <div className="mt-1 flex max-w-[240px] items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-elevation-3">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : bag.status === 'error' ? (
          <span className="block truncate text-[12px] leading-tight text-destructive">
            {t('storage.errors.noSpace')}
          </span>
        ) : (
          <span className="block truncate text-[12px] leading-tight text-muted-foreground">
            {metaParts.join(' · ')}
          </span>
        )}
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 transition-opacity',
          selected
            ? 'opacity-100'
            : 'opacity-0 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100'
        )}
      >
        <RowIconButton
          label={t('storage.actions.openFolder')}
          onClick={() => onOpenFolder(bag.id)}
          icon={<FolderOpen className="h-3.5 w-3.5" />}
        />
        <RowIconButton
          label={t('storage.actions.copyBagId')}
          onClick={() => onCopyId(bag.id)}
          icon={<Copy className="h-3.5 w-3.5" />}
        />
        <RowIconButton
          label={t('storage.actions.remove')}
          onClick={() => onRemove(bag.id)}
          danger
          icon={<Trash2 className="h-3.5 w-3.5" />}
        />
      </div>

      <StatusIndicator status={bag.status} progress={progress} isDownloading={isDownloading} />
    </div>
  )
})

function RowIconButton({
  label,
  onClick,
  icon,
  danger,
}: {
  label: string
  onClick: () => void
  icon: ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'rounded-full p-1 text-muted-foreground transition-colors',
        danger ? 'hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-surface-hover hover:text-foreground'
      )}
    >
      {icon}
    </button>
  )
}

// Right-side state indicator: percentage (downloading), check (complete),
// muted percentage (paused) or an "error" label.
function StatusIndicator({
  status,
  progress,
  isDownloading,
}: {
  status: StorageBag['status']
  progress: number
  isDownloading: boolean
}) {
  const { t } = useTranslation('pages')

  if (status === 'seeding' && progress >= 100) {
    return (
      <span className="flex w-10 shrink-0 justify-end">
        <Check className="h-4 w-4 text-success" strokeWidth={2.5} aria-label={t('storage.status.completed')} />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="w-10 shrink-0 text-right text-[12px] font-semibold text-destructive">
        {t('storage.status.error')}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'w-10 shrink-0 text-right text-[13px] font-semibold tabular-nums',
        isDownloading ? 'text-primary' : 'text-muted-foreground'
      )}
    >
      {Math.round(progress)}%
    </span>
  )
}
