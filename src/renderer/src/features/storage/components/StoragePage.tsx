/**
 * Storage page - TON Storage management.
 * Add, remove, pause, and monitor bags.
 *
 * Layout iOS : sidebar flottante détachée (filtres + seeding + réglages) à gauche,
 * liste de bags à droite (statut porté par le pourcentage), inspecteur flottant en
 * bas pour le détail du bag sélectionné.
 */

import { useState, useEffect, useCallback, memo } from 'react'
import { createLogger } from '@/logger'
import { Check, HardDrive, Search, X } from 'lucide-react'

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
import { BagInspector } from './storage/BagInspector'
import { filterBags, bagCounts, type FilterType } from './storage/bag-filter'
import { AddBagModal } from './storage/AddBagModal'

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

  const handleSelectBag = useCallback(
    (bag: StorageBag) => {
      setSelectedBag(bag)
      setBagDetails(null)
      setDetailTab('info')
      loadBagDetails(bag.id)
    },
    [loadBagDetails]
  )

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

  const handleShowFile = async (bagId: string, fileName: string) => {
    try {
      await storageClient.showFile(bagId, fileName)
    } catch (error) {
      log.error('Failed to show file:', error)
    }
  }

  const filteredBags = filterBags(bags, filter, searchQuery)
  const counts = bagCounts(bags)

  const handleCopyBagId = useCallback(async (bagId: string) => {
    try {
      await navigator.clipboard.writeText(bagId)
    } catch (err) {
      log.error('Failed to copy bag ID:', err)
    }
  }, [])

  return (
    <div className="flex h-full bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Floating detached sidebar */}
      <StorageSidebar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        onAddBag={() => setShowAddModal(true)}
      />

      {/* Main content */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col overflow-auto">
          {/* Title + search */}
          <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-5">
            <h2 className="text-[17px] font-semibold text-heading">
              {t('storage.bagsTitle', { defaultValue: 'Bags' })}
              <span className="ml-1.5 font-medium text-muted-foreground tabular-nums">({filteredBags.length})</span>
            </h2>
            <div className="flex w-72 items-center gap-2 rounded-full bg-surface px-3.5 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('storage.searchBags')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* List — extra bottom padding leaves room for the floating inspector */}
          <div className={cn('flex-1 px-6 pb-6', selectedBag && 'pb-28')}>
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
                    onRemove={handleRemoveBag}
                  />
                ))}
              </InsetGroup>
            )}
          </div>
        </div>

        {/* Floating inspector bar */}
        <BagInspector
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
          onClose={() => {
            setSelectedBag(null)
            setBagDetails(null)
          }}
        />
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
  onRemove,
}: {
  bag: StorageBag
  selected: boolean
  onClick: (bag: StorageBag) => void
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
      onClick={() => onClick(bag)}
      className={cn(
        'group flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors',
        selected ? 'bg-[hsl(var(--primary)/0.14)]' : 'hover:bg-surface-hover'
      )}
    >
      {/* Name + subtitle */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-foreground">{bag.name}</span>
        {isDownloading ? (
          <div className="mt-1.5 flex max-w-[280px] items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevation-3">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : bag.status === 'error' ? (
          <span className="mt-0.5 block truncate text-[13px] text-destructive">{t('storage.errors.noSpace')}</span>
        ) : (
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{metaParts.join(' · ')}</span>
        )}
      </div>

      {/* Right indicator — the dominant state signal */}
      <StatusIndicator status={bag.status} progress={progress} isDownloading={isDownloading} />

      {/* Remove (hover) */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(bag.id)
        }}
        title={t('storage.actions.remove')}
        className="shrink-0 rounded-full p-1.5 text-muted-foreground opacity-0 transition-colors pointer-events-none hover:bg-destructive/10 hover:text-destructive group-hover:pointer-events-auto group-hover:opacity-100"
      >
        <X className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  )
})

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
      <span className="flex w-16 shrink-0 justify-end">
        <Check className="h-5 w-5 text-success" strokeWidth={2.5} aria-label={t('storage.status.completed')} />
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="w-16 shrink-0 text-right text-[15px] font-semibold text-destructive">
        {t('storage.status.error')}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'w-16 shrink-0 text-right text-[22px] font-bold tracking-tight tabular-nums',
        isDownloading ? 'text-primary' : 'text-muted-foreground'
      )}
    >
      {Math.round(progress)}%
    </span>
  )
}
