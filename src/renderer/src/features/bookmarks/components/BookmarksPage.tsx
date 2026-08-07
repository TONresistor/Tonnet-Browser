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
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { RotateCcw, Search, Plus, Download, GripVertical } from 'lucide-react'
import { useBookmarksStore } from '@/features/bookmarks/store'
import { useAddBrowserTab, useNavigateActiveBrowserTab } from '@/features/browser/navigation'
import { useTranslation } from 'react-i18next'
import { downloadJson } from '@/lib/download'
import { Favicon } from '@/components/ui/Favicon'
import { useConfirmAction } from '@/hooks/useConfirmAction'
import { DroppableFolderItem, SortableBookmarkRow } from './BookmarkManagerItems'

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
  const navigateActiveTab = useNavigateActiveBrowserTab()
  const addTab = useAddBrowserTab()

  // Local state
  const [query, setQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const deleteConfirm = useConfirmAction()
  const folderDeleteConfirm = useConfirmAction()
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
  const maxDepthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
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
      if (deleteConfirm.trigger(id)) {
        removeBookmark(id)
      }
    },
    [deleteConfirm, removeBookmark]
  )

  const handleDeleteFolder = useCallback(
    (folderId: string) => {
      if (folderDeleteConfirm.trigger(folderId)) {
        removeFolder(folderId)
        if (selectedFolderId === folderId) setSelectedFolderId(null)
      }
    },
    [folderDeleteConfirm, removeFolder, selectedFolderId]
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
    downloadJson({ bookmarks, folders }, 'ton-browser-bookmarks.json')
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
        const dragged = bookmarks.find((b) => b.id === draggedId)
        if (!dragged) return
        // In a single-folder view reorder within that folder. In the aggregate
        // ("All Bookmarks") / search view the list spans folders, so keep the
        // bookmark in its OWN folder (never move it to Unfiled) and index it
        // among that folder's members — not the cross-folder list.
        const targetFolderId = selectedFolderId !== null ? selectedFolderId : (dragged.folderId ?? null)
        const folderMembers = sortedDisplayBookmarks.filter((b) => (b.folderId ?? null) === targetFolderId)
        const overIdx = folderMembers.findIndex((b) => b.id === overId)
        reorderBookmarks(draggedId, targetFolderId, overIdx === -1 ? folderMembers.length : overIdx)
      }
    },
    [reorderBookmarks, sortedDisplayBookmarks, selectedFolderId, bookmarks]
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
          isPendingDelete={folderDeleteConfirm.isArmed(folder.id)}
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

  return (
    <div className="flex h-full bg-background-secondary" style={{ fontFamily: 'Inter, sans-serif' }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Floating folder sidebar */}
        <aside className="m-3 flex w-[260px] shrink-0 flex-col overflow-hidden rounded-panel border border-border-subtle bg-elevation-1 shadow-panel">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h1 className="text-[22px] font-bold tracking-tight text-heading">{t('bookmarks.title')}</h1>
            <button
              onClick={() => handleNewFolder(selectedFolderId)}
              className="grid h-7 w-7 place-items-center rounded-full bg-primary text-identity-foreground transition-colors hover:bg-primary/90"
              title={t('bookmarks.newFolder')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {maxDepthWarning && <p className="px-4 pb-1 text-xs text-warning">{t('bookmarks.maxDepthReached')}</p>}

          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
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
          </nav>

          <div className="shrink-0 space-y-0.5 border-t border-border-subtle p-2">
            <button
              onClick={handleExport}
              className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Download className="h-4 w-4" />
              {t('bookmarks.export')}
            </button>
            <button
              onClick={() => setShowResetModal(true)}
              className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4" />
              {t('bookmarks.reset')}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          <div className="px-6 pb-3 pt-5">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('bookmarks.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 w-full rounded-full bg-surface pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="flex-1 px-6 pb-6">
            {sortedDisplayBookmarks.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {query ? t('bookmarks.noMatch') : t('bookmarks.noBookmarks')}
              </div>
            ) : (
              <SortableContext items={sortedDisplayBookmarks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <div className="overflow-hidden rounded-card border border-border-subtle bg-elevation-2 divide-y divide-border-subtle">
                  {sortedDisplayBookmarks.map((bookmark) => (
                    <SortableBookmarkRow
                      key={bookmark.id}
                      bookmark={bookmark}
                      isPendingDelete={deleteConfirm.isArmed(bookmark.id)}
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
            <div className="flex items-center gap-3 rounded-card border border-border-subtle bg-elevation-2 p-4 opacity-90 shadow-panel">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              <Favicon
                src={activeBookmark.favicon}
                className="w-4 h-4 object-contain"
                fallbackClassName="w-4 h-4 text-muted-foreground"
              />
              <span className="text-sm text-foreground">{activeBookmark.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Edit Bookmark Modal */}
      {editingBookmark && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
          onClick={() => setEditingBookmark(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-panel border border-border-subtle bg-elevation-1 p-6 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold text-heading mb-4">{t('bookmarks.editBookmark')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.bookmarkTitle')}</label>
                <input
                  value={editingBookmark.title}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, title: e.target.value })}
                  className="w-full rounded-card bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.url')}</label>
                <input
                  value={editingBookmark.url}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, url: e.target.value })}
                  className="w-full rounded-card bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.folder')}</label>
                <select
                  value={editingBookmark.folderId ?? ''}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, folderId: e.target.value || null })}
                  className="w-full rounded-card bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
                className="flex-1 rounded-full border border-border-subtle bg-surface-hover py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-active"
                onClick={() => setEditingBookmark(null)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 rounded-full bg-primary py-2.5 text-sm font-medium text-identity-foreground transition-colors hover:bg-primary/90"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
          onClick={() => setCreatingFolder(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-panel border border-border-subtle bg-elevation-1 p-6 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold text-heading mb-4">{t('bookmarks.newFolderTitle')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.name')}</label>
                <input
                  value={creatingFolder.name}
                  onChange={(e) => setCreatingFolder({ ...creatingFolder, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveNewFolder()
                  }}
                  className="w-full rounded-card bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={t('bookmarks.folderPlaceholder')}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 rounded-full border border-border-subtle bg-surface-hover py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-active"
                onClick={() => setCreatingFolder(null)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 rounded-full bg-primary py-2.5 text-sm font-medium text-identity-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
          onClick={() => setEditingFolder(null)}
        >
          <div
            className="w-full max-w-md mx-4 rounded-panel border border-border-subtle bg-elevation-1 p-6 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold text-heading mb-4">{t('bookmarks.renameFolder')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{t('bookmarks.name')}</label>
                <input
                  value={editingFolder.name}
                  onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveFolderEdit()
                  }}
                  className="w-full rounded-card bg-surface px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 rounded-full border border-border-subtle bg-surface-hover py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-active"
                onClick={() => setEditingFolder(null)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 rounded-full bg-primary py-2.5 text-sm font-medium text-identity-foreground transition-colors hover:bg-primary/90"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
          onClick={() => setShowResetModal(false)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-panel border border-border-subtle bg-elevation-1 p-6 shadow-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-semibold text-heading mb-2">{t('bookmarks.resetBookmarks')}</h3>
            <p className="text-sm text-muted-foreground mb-6">{t('bookmarks.deleteFolderConfirm')}</p>
            <div className="flex gap-3">
              <button
                className="flex-1 rounded-full border border-border-subtle bg-surface-hover py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-active"
                onClick={() => setShowResetModal(false)}
              >
                {t('bookmarks.cancel')}
              </button>
              <button
                className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
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
