/**
 * Bookmarks Page - ton://bookmarks
 * Full bookmark manager with folder tree, drag & drop, search, and editing.
 */

import { memo, useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  ExternalLink,
  RotateCcw,
  Search,
  Plus,
  SquarePen,
  Trash2,
  Globe,
  Download,
  GripVertical,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Pen,
} from 'lucide-react'
import { useBookmarksStore, type Bookmark, type BookmarkFolder } from '@/stores/bookmarks'
import { useTabsStore } from '@/stores/tabs'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

// --- Sortable Bookmark Row ---

function SortableBookmarkRow({
  bookmark,
  isPendingDelete,
  onNavigate,
  onOpenNewTab,
  onEdit,
  onDelete,
}: {
  bookmark: Bookmark
  isPendingDelete: boolean
  onNavigate: (url: string) => void
  onOpenNewTab: (url: string) => void
  onEdit: (bookmark: Bookmark) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation('settings')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bookmark.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'p-4 hover:bg-surface-hover transition-colors group flex items-center gap-3',
        isDragging && 'z-10 shadow-lg'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {bookmark.favicon ? (
        <img
          src={bookmark.favicon}
          alt=""
          className="w-4 h-4 flex-shrink-0 object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <Globe className="w-4 h-4 text-foreground-muted flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <button
          onClick={() => onNavigate(bookmark.url)}
          className="font-medium text-primary hover:text-primary/80 truncate text-left block"
        >
          {bookmark.title}
        </button>
        <div className="text-xs text-muted-foreground truncate">{bookmark.url}</div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onOpenNewTab(bookmark.url)}
          className="p-2 hover:bg-surface-active rounded transition-colors"
          title={t('bookmarks.openInNewTab')}
        >
          <ExternalLink className="w-4 h-4 text-foreground" />
        </button>
        <button
          onClick={() => onEdit(bookmark)}
          className="p-2 hover:bg-surface-active rounded transition-colors"
          title={t('bookmarks.edit')}
        >
          <SquarePen className="w-4 h-4 text-foreground" />
        </button>
        <button
          onClick={() => onDelete(bookmark.id)}
          className={cn(
            'p-2 rounded transition-colors',
            isPendingDelete ? 'bg-destructive/20' : 'hover:bg-destructive/10'
          )}
          title={t('bookmarks.delete')}
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </button>
      </div>
    </div>
  )
}

// --- Droppable Folder Item in Tree ---

function DroppableFolderItem({
  folder,
  isRoot,
  level,
  isSelected,
  isExpanded,
  hasSubfolders,
  bookmarksCount,
  isPendingDelete,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
  children,
}: {
  folder: BookmarkFolder | null
  isRoot: boolean
  level: number
  isSelected: boolean
  isExpanded: boolean
  hasSubfolders: boolean
  bookmarksCount: number
  isPendingDelete: boolean
  onSelect: () => void
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: (e: React.MouseEvent) => void
  children?: React.ReactNode
}) {
  const { t } = useTranslation('settings')
  const folderId = folder?.id ?? 'root-unfiled'
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${folderId}`,
    data: { type: 'folder', folderId: folder?.id ?? null },
  })

  return (
    <div>
      <button
        ref={setNodeRef}
        onClick={() => {
          if (hasSubfolders && !isRoot) onToggleExpand()
          onSelect()
        }}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors rounded-lg group',
          isOver && 'ring-2 ring-primary bg-primary/10',
          isSelected
            ? 'bg-surface-active text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
        )}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        {hasSubfolders && !isRoot && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            className="p-0.5 hover:bg-surface-active rounded transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        )}

        {isRoot ? (
          <Folder className="w-4 h-4 flex-shrink-0" />
        ) : isExpanded ? (
          <FolderOpen className="w-4 h-4 flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 flex-shrink-0" />
        )}

        <span className="flex-1 text-left truncate">{isRoot ? t('bookmarks.allBookmarks') : folder!.name}</span>

        {bookmarksCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface/50">{bookmarksCount}</span>
        )}

        {!isRoot && folder && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <span
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              className="p-1 hover:bg-surface-active rounded transition-colors cursor-pointer"
              title={t('bookmarks.renameFolder')}
            >
              <Pen className="w-3.5 h-3.5" />
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation()
                onDelete(e)
              }}
              className={cn(
                'p-1 rounded transition-colors cursor-pointer',
                isPendingDelete ? 'bg-destructive/20' : 'hover:bg-destructive/10'
              )}
              title={t('bookmarks.deleteFolder')}
            >
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </span>
          </div>
        )}
      </button>
      {isExpanded && children}
    </div>
  )
}

// --- Main Page ---

export const BookmarksPage = memo(function BookmarksPage() {
  const { t } = useTranslation('settings')

  // Store selectors
  const bookmarks = useBookmarksStore((s) => s.bookmarks)
  const folders = useBookmarksStore((s) => s.folders)
  const searchBookmarks = useBookmarksStore((s) => s.searchBookmarks)
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark)
  const updateBookmark = useBookmarksStore((s) => s.updateBookmark)
  const getBookmarksByFolder = useBookmarksStore((s) => s.getBookmarksByFolder)
  const addFolder = useBookmarksStore((s) => s.addFolder)
  const updateFolder = useBookmarksStore((s) => s.updateFolder)
  const removeFolder = useBookmarksStore((s) => s.removeFolder)
  const getFolderDepth = useBookmarksStore((s) => s.getFolderDepth)
  const getSubfolders = useBookmarksStore((s) => s.getSubfolders)
  const resetBookmarks = useBookmarksStore((s) => s.resetBookmarks)
  const reorderBookmarks = useBookmarksStore((s) => s.reorderBookmarks)
  const navigateActiveTab = useTabsStore((s) => s.navigateActiveTab)
  const addTab = useTabsStore((s) => s.addTab)

  // Local state
  const [query, setQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [pendingFolderDeleteId, setPendingFolderDeleteId] = useState<string | null>(null)
  const [showResetModal, setShowResetModal] = useState(false)
  const [maxDepthWarning, setMaxDepthWarning] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Edit modals
  const [editingBookmark, setEditingBookmark] = useState<{
    id: string
    title: string
    url: string
    folderId: string | null
  } | null>(null)
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null)
  const [creatingFolder, setCreatingFolder] = useState<{
    parentId: string | null
    name: string
  } | null>(null)

  // Timers
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const folderDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxDepthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
      if (maxDepthTimerRef.current) clearTimeout(maxDepthTimerRef.current)
    }
  }, [])

  // Display bookmarks based on search/folder selection
  const displayBookmarks = useMemo(() => {
    if (query) return searchBookmarks(query)
    if (selectedFolderId === null) return bookmarks
    return getBookmarksByFolder(selectedFolderId)
  }, [query, selectedFolderId, bookmarks, searchBookmarks, getBookmarksByFolder])

  // Sorted for the current view (for dnd-kit)
  const sortedDisplayBookmarks = useMemo(() => {
    return [...displayBookmarks].sort((a, b) => a.order - b.order)
  }, [displayBookmarks])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Handlers
  const toggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const handleDeleteBookmark = useCallback(
    (id: string) => {
      if (pendingDeleteId === id) {
        removeBookmark(id)
        setPendingDeleteId(null)
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      } else {
        setPendingDeleteId(id)
        if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
        deleteTimerRef.current = setTimeout(() => setPendingDeleteId(null), UI_NOTIFICATION_TIMEOUT_MS)
      }
    },
    [pendingDeleteId, removeBookmark]
  )

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      if (pendingFolderDeleteId === folderId) {
        removeFolder(folderId)
        setPendingFolderDeleteId(null)
        if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
        if (selectedFolderId === folderId) setSelectedFolderId(null)
      } else {
        setPendingFolderDeleteId(folderId)
        if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
        folderDeleteTimerRef.current = setTimeout(() => setPendingFolderDeleteId(null), UI_NOTIFICATION_TIMEOUT_MS)
      }
    },
    [pendingFolderDeleteId, removeFolder, selectedFolderId]
  )

  const handleNewFolder = useCallback(
    (parentId: string | null) => {
      const depth = getFolderDepth(parentId)
      if (depth >= 3) {
        setMaxDepthWarning(true)
        if (maxDepthTimerRef.current) clearTimeout(maxDepthTimerRef.current)
        maxDepthTimerRef.current = setTimeout(() => setMaxDepthWarning(false), UI_NOTIFICATION_TIMEOUT_MS)
        return
      }
      setCreatingFolder({ parentId, name: '' })
    },
    [getFolderDepth]
  )

  const handleSaveNewFolder = useCallback(() => {
    if (creatingFolder && creatingFolder.name.trim()) {
      const newId = addFolder(creatingFolder.name.trim(), creatingFolder.parentId)
      setCreatingFolder(null)
      if (newId) {
        // Auto-expand parent and select new folder
        if (creatingFolder.parentId) {
          setExpandedFolders((prev) => new Set([...prev, creatingFolder.parentId!]))
        }
        setExpandedFolders((prev) => new Set([...prev, newId]))
        setSelectedFolderId(newId)
      }
    }
  }, [creatingFolder, addFolder])

  const handleSaveEdit = useCallback(() => {
    if (editingBookmark) {
      updateBookmark(editingBookmark.id, {
        title: editingBookmark.title,
        url: editingBookmark.url,
        folderId: editingBookmark.folderId,
      })
      setEditingBookmark(null)
    }
  }, [editingBookmark, updateBookmark])

  const handleSaveFolderEdit = useCallback(() => {
    if (editingFolder && editingFolder.name.trim()) {
      updateFolder(editingFolder.id, { name: editingFolder.name.trim() })
      setEditingFolder(null)
    }
  }, [editingFolder, updateFolder])

  const handleExport = useCallback(() => {
    const data = JSON.stringify({ bookmarks, folders }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ton-browser-bookmarks.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [bookmarks, folders])

  const handleReset = useCallback(() => {
    resetBookmarks()
    setShowResetModal(false)
    setSelectedFolderId(null)
    setExpandedFolders(new Set())
  }, [resetBookmarks])

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      if (!over) return

      const draggedId = active.id as string
      const overId = over.id as string

      // Dropped on a folder droppable zone
      if (overId.startsWith('drop-')) {
        const targetFolderId = over.data.current?.folderId ?? null
        reorderBookmarks(draggedId, targetFolderId, 0)
        return
      }

      // Reorder within same list
      if (draggedId !== overId) {
        const oldIndex = sortedDisplayBookmarks.findIndex((b) => b.id === draggedId)
        const newIndex = sortedDisplayBookmarks.findIndex((b) => b.id === overId)
        if (oldIndex !== -1 && newIndex !== -1) {
          reorderBookmarks(draggedId, selectedFolderId, newIndex)
        }
      }
    },
    [reorderBookmarks, sortedDisplayBookmarks, selectedFolderId]
  )

  const activeBookmark = activeId ? bookmarks.find((b) => b.id === activeId) : null

  // Render folder tree recursively
  const renderFolderTree = (parentId: string | null, level: number): React.ReactNode => {
    const subfolders = getSubfolders(parentId)
    return subfolders.map((folder) => {
      const childFolders = getSubfolders(folder.id)
      const isExpanded = expandedFolders.has(folder.id)
      const count = getBookmarksByFolder(folder.id).length

      return (
        <DroppableFolderItem
          key={folder.id}
          folder={folder}
          isRoot={false}
          level={level}
          isSelected={selectedFolderId === folder.id}
          isExpanded={isExpanded}
          hasSubfolders={childFolders.length > 0}
          bookmarksCount={count}
          isPendingDelete={pendingFolderDeleteId === folder.id}
          onSelect={() => setSelectedFolderId(folder.id)}
          onToggleExpand={() => toggleExpand(folder.id)}
          onEdit={() => setEditingFolder({ id: folder.id, name: folder.name })}
          onDelete={() => handleDeleteFolder(folder.id)}
        >
          {isExpanded && renderFolderTree(folder.id, level + 1)}
        </DroppableFolderItem>
      )
    })
  }

  // Empty state
  if (bookmarks.length === 0 && folders.length === 0) {
    return (
      <div className="h-full overflow-auto bg-background">
        <div className="max-w-4xl mx-auto p-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">{t('bookmarks.title')}</h1>
          <div className="text-center py-24 text-muted-foreground">{t('bookmarks.noBookmarks')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-4xl mx-auto p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t('bookmarks.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {bookmarks.length} {t('bookmarks.savedBookmarks').toLowerCase()}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
            >
              <Download className="h-4 w-4" />
              {t('bookmarks.export')}
            </button>
            <button
              onClick={() => setShowResetModal(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-neutral-500/15 border border-neutral-500/30 text-neutral-400 hover:text-neutral-300"
            >
              <RotateCcw className="h-4 w-4" />
              {t('bookmarks.reset')}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={t('bookmarks.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-full focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
            />
          </div>
        </div>

        {/* Two-column layout */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4">
            {/* Folder tree */}
            <div className="w-64 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-foreground">{t('bookmarks.folders')}</h4>
                <button
                  onClick={() => handleNewFolder(selectedFolderId)}
                  className="w-6 h-6 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  title={t('bookmarks.newFolder')}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {maxDepthWarning && <p className="text-xs text-amber-500 mb-2">{t('bookmarks.maxDepthReached')}</p>}
              <div className="bg-card rounded-2xl border border-border p-3 space-y-1">
                {/* All Bookmarks */}
                <DroppableFolderItem
                  folder={null}
                  isRoot={true}
                  level={0}
                  isSelected={selectedFolderId === null}
                  isExpanded={true}
                  hasSubfolders={false}
                  bookmarksCount={bookmarks.length}
                  isPendingDelete={false}
                  onSelect={() => setSelectedFolderId(null)}
                  onToggleExpand={() => {}}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
                {renderFolderTree(null, 0)}
              </div>
            </div>

            {/* Bookmark list */}
            <div className="flex-1 min-w-0">
              {sortedDisplayBookmarks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  {query ? t('bookmarks.noMatch') : t('bookmarks.noBookmarks')}
                </div>
              ) : (
                <SortableContext items={sortedDisplayBookmarks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="bg-card rounded-2xl border border-border divide-y divide-border overflow-hidden">
                    {sortedDisplayBookmarks.map((bookmark) => (
                      <SortableBookmarkRow
                        key={bookmark.id}
                        bookmark={bookmark}
                        isPendingDelete={pendingDeleteId === bookmark.id}
                        onNavigate={navigateActiveTab}
                        onOpenNewTab={addTab}
                        onEdit={(b) =>
                          setEditingBookmark({
                            id: b.id,
                            title: b.title,
                            url: b.url,
                            folderId: b.folderId,
                          })
                        }
                        onDelete={handleDeleteBookmark}
                      />
                    ))}
                  </div>
                </SortableContext>
              )}
            </div>
          </div>

          <DragOverlay>
            {activeBookmark && (
              <div className="p-4 bg-card border border-border rounded-xl shadow-2xl opacity-90 flex items-center gap-3">
                <GripVertical className="w-4 h-4 text-muted-foreground" />
                {activeBookmark.favicon ? (
                  <img src={activeBookmark.favicon} alt="" className="w-4 h-4 object-contain" />
                ) : (
                  <Globe className="w-4 h-4 text-foreground-muted" />
                )}
                <span className="text-sm text-foreground">{activeBookmark.title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Edit Bookmark Modal */}
      {editingBookmark && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setEditingBookmark(null)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">{t('bookmarks.editBookmark')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.bookmarkTitle')}</label>
                <input
                  value={editingBookmark.title}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, title: e.target.value })}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.url')}</label>
                <input
                  value={editingBookmark.url}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, url: e.target.value })}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.folder')}</label>
                <select
                  value={editingBookmark.folderId ?? ''}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, folderId: e.target.value || null })}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="">{t('bookmarks.unfiledBookmarks')}</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setEditingBookmark(null)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleSaveEdit}
              >
                {t('bookmarks.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {creatingFolder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setCreatingFolder(null)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">{t('bookmarks.newFolderTitle')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.name')}</label>
                <input
                  value={creatingFolder.name}
                  onChange={(e) => setCreatingFolder({ ...creatingFolder, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveNewFolder()
                  }}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                  placeholder={t('bookmarks.folderPlaceholder')}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setCreatingFolder(null)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveNewFolder}
                disabled={!creatingFolder.name.trim()}
              >
                {t('bookmarks.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Folder Modal */}
      {editingFolder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setEditingFolder(null)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">{t('bookmarks.renameFolder')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.name')}</label>
                <input
                  value={editingFolder.name}
                  onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveFolderEdit()
                  }}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setEditingFolder(null)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleSaveFolderEdit}
              >
                {t('bookmarks.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setShowResetModal(false)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-sm mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2">{t('bookmarks.resetBookmarks')}</h3>
            <p className="text-sm text-muted-foreground mb-6">{t('bookmarks.deleteFolderConfirm')}</p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setShowResetModal(false)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors"
                onClick={handleReset}
              >
                {t('bookmarks.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
