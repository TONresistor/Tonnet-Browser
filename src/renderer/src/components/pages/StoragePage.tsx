/**
 * Storage page - TON Storage management.
 * Add, remove, pause, and monitor bags.
 */

import { useState, useEffect } from 'react'
import {
  Plus,
  Search,
  HardDrive,
  X,
  Settings,
  FileText,
  Info,
  Folder,
  FolderOpen,
} from 'lucide-react'
import type { StorageBag } from '@shared/types'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'

// Utility functions
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

// Regex to validate TON Storage Bag ID (64 hex characters)
const BAG_ID_REGEX = /^[a-fA-F0-9]{64}$/

type FilterType = 'all' | 'downloading' | 'complete'

interface BagFile {
  name: string
  size: number
}

interface BagDetails {
  files: BagFile[]
  path: string
}

export function StoragePage() {
  const [bags, setBags] = useState<StorageBag[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBag, setSelectedBag] = useState<StorageBag | null>(null)
  const [bagDetails, setBagDetails] = useState<BagDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailTab, setDetailTab] = useState<'info' | 'files'>('info')
  const [showAddModal, setShowAddModal] = useState(false)
  const [newBagId, setNewBagId] = useState('')
  const [bagIdError, setBagIdError] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  // Load bags on mount and listen for real-time updates
  useEffect(() => {
    loadBags()

    // Listen for real-time bag updates from storage daemon
    // Use the unsubscribe function to clean up only THIS listener (not all listeners)
    const unsubscribe = window.electron.on('storage:bags-updated', (...args: unknown[]) => {
      const updatedBags = args[0] as StorageBag[]
      setBags(updatedBags)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const loadBags = async () => {
    try {
      const result = await window.electron.storage.listBags()
      if (result.success) {
        setBags(result.bags as StorageBag[])
      }
    } catch (err) {
      console.error('Failed to load bags:', err)
    }
  }

  const handleAddBag = async () => {
    const trimmedId = newBagId.trim()
    setBagIdError('')

    if (!trimmedId) return

    // Validate bag ID format
    if (!BAG_ID_REGEX.test(trimmedId)) {
      setBagIdError('Invalid Bag ID. Must be 64 hexadecimal characters.')
      return
    }

    setIsAdding(true)
    try {
      const result = await window.electron.storage.addBag(trimmedId)
      if (result.success) {
        await loadBags()
        setNewBagId('')
        setBagIdError('')
        setShowAddModal(false)
      } else if (result.error) {
        setBagIdError(result.error)
      }
    } catch (err) {
      console.error('Failed to add bag:', err)
      setBagIdError('Failed to add bag. Please try again.')
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemoveBag = async (bagId: string) => {
    try {
      await window.electron.storage.removeBag(bagId)
      await loadBags()
      if (selectedBag?.id === bagId) {
        setSelectedBag(null)
        setBagDetails(null)
      }
    } catch (err) {
      console.error('Failed to remove bag:', err)
    }
  }

  const loadBagDetails = async (bagId: string) => {
    setLoadingDetails(true)
    try {
      const result = await window.electron.storage.getBagDetails(bagId)
      if (result.success && result.details) {
        setBagDetails({
          files: result.details.files || [],
          path: result.details.path || '',
        })
      } else {
        setBagDetails(null)
      }
    } catch (err) {
      console.error('Failed to load bag details:', err)
      setBagDetails(null)
    } finally {
      setLoadingDetails(false)
    }
  }

  const handleSelectBag = (bag: StorageBag) => {
    setSelectedBag(bag)
    setBagDetails(null)
    // Load details when selecting a bag
    loadBagDetails(bag.id)
  }

  const handleOpenFolder = async (bagId: string) => {
    const result = await window.electron.storage.openFolder(bagId)
    if (!result.success) {
      console.error('Failed to open folder:', result.error)
    }
  }

  const handleShowFile = async (bagId: string, fileName: string) => {
    const result = await window.electron.storage.showFile(bagId, fileName)
    if (!result.success) {
      console.error('Failed to show file:', result.error)
    }
  }

  const navigateToSettings = () => {
    window.electron.navigate('ton://settings')
    useSettingsStore.getState().setNavigation('ton://settings', false, false)
  }

  // Filter bags
  const filteredBags = bags.filter((bag) => {
    // Apply status filter
    if (filter === 'downloading' && bag.status !== 'downloading') return false
    if (filter === 'complete' && bag.status !== 'seeding') return false

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        bag.name.toLowerCase().includes(query) ||
        bag.id.toLowerCase().includes(query)
      )
    }
    return true
  })

  // Count by status
  const counts = {
    all: bags.length,
    downloading: bags.filter((b) => b.status === 'downloading').length,
    complete: bags.filter((b) => b.status === 'seeding').length,
  }

  return (
    <div className="flex h-full bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      {/* Sidebar */}
      <div className="w-56 border-r border-border p-4 flex flex-col">
        <h2 className="text-foreground text-xl font-bold mb-4">TON Storage</h2>

        <button
          onClick={() => setShowAddModal(true)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] bg-primary/90 backdrop-blur-[10px] text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.4),inset_0_1px_0_hsl(var(--foreground)/0.2)]"
        >
          <Plus className="h-4 w-4" />
          Add Bag
        </button>

        {/* Filters */}
        <div className="space-y-2 mb-6 mt-4">
          <FilterButton
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            count={counts.all}
          >
            All
          </FilterButton>
          <FilterButton
            active={filter === 'downloading'}
            onClick={() => setFilter('downloading')}
            count={counts.downloading}
          >
            Downloading
          </FilterButton>
          <FilterButton
            active={filter === 'complete'}
            onClick={() => setFilter('complete')}
            count={counts.complete}
          >
            Complete
          </FilterButton>
        </div>

        {/* Settings button at bottom */}
        <div className="mt-auto">
          <button
            onClick={navigateToSettings}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-full text-sm text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface backdrop-blur-[10px] border border-border-subtle"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search Bar */}
        <div className="p-4 border-b border-border flex justify-end">
          <div
            className="w-64 flex items-center rounded-full px-3 bg-surface-hover backdrop-blur-[20px] border border-border-medium shadow-[inset_0_1px_0_hsl(var(--surface-hover))]"
          >
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bags..."
              className="flex-1 bg-transparent border-none py-2.5 px-3 text-foreground text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {filteredBags.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <HardDrive className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg mb-2">No bags yet</p>
              <p className="text-sm">Click "+ Add Bag" to get started</p>
            </div>
          ) : (
            <div className="p-4">
              <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                <thead>
                  <tr
                    className="text-left text-xs text-muted-foreground uppercase tracking-wider bg-surface backdrop-blur-[10px]"
                  >
                    <th className="px-4 py-3 font-medium rounded-l-full">Name</th>
                    <th className="px-4 py-3 font-medium w-24">Size</th>
                    <th className="px-4 py-3 font-medium w-40">Progress</th>
                    <th className="px-4 py-3 font-medium w-28">Status</th>
                    <th className="px-4 py-3 font-medium w-20">Files</th>
                    <th className="px-4 py-3 font-medium w-12 rounded-r-full"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBags.map((bag) => (
                    <BagRow
                      key={bag.id}
                      bag={bag}
                      selected={selectedBag?.id === bag.id}
                      onClick={() => handleSelectBag(bag)}
                      onRemove={() => handleRemoveBag(bag.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedBag && (
          <div className="border-t border-border bg-background-secondary">
            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setDetailTab('info')}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  detailTab === 'info'
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                )}
              >
                <Info className="h-4 w-4 inline mr-2" />
                Info
              </button>
              <button
                onClick={() => setDetailTab('files')}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  detailTab === 'files'
                    ? 'text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground'
                )}
              >
                <FileText className="h-4 w-4 inline mr-2" />
                Files
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-4 max-h-48 overflow-auto">
              {detailTab === 'info' ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div className="flex">
                    <span className="text-muted-foreground w-24">ID</span>
                    <span className="text-foreground/80 font-mono text-xs break-all">
                      {selectedBag.id}
                    </span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Size</span>
                    <span className="text-foreground">{formatBytes(selectedBag.size)}</span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Downloaded</span>
                    <span className="text-foreground">{formatBytes(selectedBag.downloaded)}</span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Status</span>
                    <span className="text-foreground">{selectedBag.status}</span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Peers</span>
                    <span className="text-foreground">{selectedBag.peers}</span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Files</span>
                    <span className="text-foreground">{selectedBag.filesCount ?? '-'}</span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Download</span>
                    <span className="text-foreground">{formatSpeed(selectedBag.downloadSpeed)}</span>
                  </div>
                  <div className="flex">
                    <span className="text-muted-foreground w-24">Upload</span>
                    <span className="text-foreground">{formatSpeed(selectedBag.uploadSpeed)}</span>
                  </div>
                  <div className="flex col-span-2">
                    <span className="text-muted-foreground w-24 flex-shrink-0">Path</span>
                    <button
                      onClick={() => handleOpenFolder(selectedBag.id)}
                      className="flex items-center gap-2 text-muted-foreground text-xs hover:text-primary transition-colors cursor-pointer group text-left"
                    >
                      <span className="break-all">{bagDetails?.path || `~/Downloads/TON-Storage/${selectedBag.id.slice(0, 16)}`}</span>
                      <FolderOpen className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </button>
                  </div>
                </div>
              ) : loadingDetails ? (
                <div className="text-muted-foreground text-sm flex items-center gap-2">
                  <Folder className="h-4 w-4 animate-pulse" />
                  <span>Loading files...</span>
                </div>
              ) : bagDetails && bagDetails.files.length > 0 ? (
                <div className="space-y-1">
                  {bagDetails.files.map((file, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleShowFile(selectedBag.id, file.name)}
                      className="flex items-center gap-3 text-sm py-1 px-2 rounded hover:bg-background cursor-pointer group"
                    >
                      <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-foreground truncate flex-1">{file.name}</span>
                      <FolderOpen className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      <span className="text-muted-foreground text-xs">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  <span>No files found or metadata not yet loaded</span>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Add Bag Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => {
            setShowAddModal(false)
            setBagIdError('')
            setNewBagId('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowAddModal(false)
              setBagIdError('')
              setNewBagId('')
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-bag-title"
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-card/85 backdrop-blur-[20px] border border-border-medium shadow-[0_8px_32px_hsl(var(--shadow-color)/0.4),inset_0_1px_0_hsl(var(--surface-hover))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="add-bag-title" className="text-foreground font-semibold text-lg">Add Bag</h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false)
                  setBagIdError('')
                  setNewBagId('')
                }}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-muted-foreground text-sm mb-4">
              Enter the Bag ID to start downloading. You can find bag IDs on TON sites or from other users.
            </p>

            <div className="mb-4">
              <label className="block text-muted-foreground text-xs uppercase tracking-wider mb-2">
                Bag ID
              </label>
              <input
                type="text"
                value={newBagId}
                onChange={(e) => {
                  setNewBagId(e.target.value)
                  setBagIdError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newBagId.trim() && !isAdding) {
                    handleAddBag()
                  }
                }}
                placeholder="Paste bag ID (64 hex characters)..."
                className={`w-full px-3 py-2 bg-background-secondary border rounded-md text-foreground placeholder:text-muted-foreground/50 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary ${bagIdError ? 'border-destructive' : 'border-border'}`}
                autoFocus
              />
              {bagIdError && (
                <p className="mt-2 text-destructive text-xs">{bagIdError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false)
                  setBagIdError('')
                  setNewBagId('')
                }}
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover backdrop-blur-[10px] border border-border-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddBag}
                disabled={!newBagId.trim() || isAdding}
                className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 bg-primary/90 backdrop-blur-[10px] text-primary-foreground shadow-[0_4px_16px_hsl(var(--primary)/0.4),inset_0_1px_0_hsl(var(--foreground)/0.2)]"
              >
                {isAdding ? 'Adding...' : 'Add Bag'}
              </button>
            </div>
          </div>
        </div>
      )}
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
        'w-full flex items-center justify-between px-3 py-2 rounded-full text-sm transition-all duration-200 backdrop-blur-[10px]',
        active
          ? 'bg-surface-active border border-border-strong text-foreground'
          : 'bg-surface border border-border-subtle'
      )}
    >
      <span className={active ? '' : 'text-muted-foreground'}>{children}</span>
      <span className={cn('text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  )
}

// Bag Row Component
function BagRow({
  bag,
  selected,
  onClick,
  onRemove,
}: {
  bag: StorageBag
  selected: boolean
  onClick: () => void
  onRemove: () => void
}) {
  const progress = bag.size > 0 ? (bag.downloaded / bag.size) * 100 : 0
  const isComplete = bag.status === 'seeding'

  return (
    <tr
      onClick={onClick}
      className={cn(
        'cursor-pointer transition-all duration-200 backdrop-blur-[10px] rounded-full',
        selected
          ? 'bg-primary/15 border border-primary/30'
          : 'bg-foreground/[0.03] border border-foreground/[0.05] hover:bg-surface-hover hover:border-border-subtle'
      )}
    >
      <td className="px-4 py-3 rounded-l-full">
        <span className="text-foreground text-sm font-medium">{bag.name}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-muted-foreground text-sm">{formatBytes(bag.size)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex-1 h-2 rounded-full overflow-hidden bg-surface-hover shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/0.2)]"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                isComplete
                  ? 'bg-gradient-to-r from-success to-success/70 shadow-[0_0_10px_hsl(var(--success)/0.5)]'
                  : 'gradient-primary shadow-[0_0_10px_hsl(var(--primary)/0.5)]'
              )}
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
        <span className="text-muted-foreground text-sm">
          {bag.filesCount ?? '-'}
        </span>
      </td>
      <td className="px-4 py-3 rounded-r-full">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded-full hover:bg-destructive/10"
        >
          <X className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

// Status Badge Component
function StatusBadge({ status }: { status: StorageBag['status'] }) {
  const config = {
    downloading: { className: 'text-primary', label: 'downloading' },
    seeding: { className: 'text-success', label: 'completed' },
    paused: { className: 'text-muted-foreground', label: 'paused' },
    error: { className: 'text-destructive', label: 'error' },
  }

  const { className, label } = config[status]

  return (
    <span className={cn('text-xs', className)}>
      {label}
    </span>
  )
}
