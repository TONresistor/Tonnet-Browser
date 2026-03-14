/**
 * Bookmarks toolbar.
 * Displays and manages saved bookmarks with folder support.
 * Includes drag & drop functionality for reordering.
 */

import { useState, useEffect, useRef } from 'react'
import { createLogger } from '@/logger'

const log = createLogger('bookmarks')
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
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useBookmarksStore, Bookmark, BookmarkFolder } from '@/stores/bookmarks'
import { useBrowserStore } from '@/stores/browser'
import { useTabsStore } from '@/stores/tabs'
import { ErrorBoundary } from '../ErrorBoundary'
import { SortableBookmarkItem } from './SortableBookmarkItem'
import { DroppableFolder } from './DroppableFolder'

interface EditModal {
  bookmark: Bookmark
  name: string
  url: string
}

interface RenameModal {
  folderId: string
  name: string
}

export function BookmarksBar() {
  const {
    bookmarks,
    folders,
    getBookmarksByFolder,
    getSubfolders,
    updateBookmark,
    removeBookmark,
    updateFolder,
    removeFolder,
    reorderBookmarks,
    reorderFolders,
  } = useBookmarksStore()
  const { proxyConnected } = useBrowserStore()
  const { navigateActiveTab, addTab } = useTabsStore()
  const [editModal, setEditModal] = useState<EditModal | null>(null)
  const [renameModal, setRenameModal] = useState<RenameModal | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const editModalRef = useRef<HTMLDivElement>(null)
  const renameModalRef = useRef<HTMLDivElement>(null)

  // Use refs to avoid re-registering listeners
  const addTabRef = useRef(addTab)
  const removeBookmarkRef = useRef(removeBookmark)
  const removeFolderRef = useRef(removeFolder)
  const getBookmarksByFolderRef = useRef(getBookmarksByFolder)

  // Keep refs updated
  useEffect(() => {
    addTabRef.current = addTab
    removeBookmarkRef.current = removeBookmark
    removeFolderRef.current = removeFolder
    getBookmarksByFolderRef.current = getBookmarksByFolder
  }, [addTab, removeBookmark, removeFolder, getBookmarksByFolder])

  // Configure drag & drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px of movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Hide/show WebContentsView when modals open/close
  useEffect(() => {
    if (editModal || renameModal) {
      window.electron.view.hide()
    } else {
      window.electron.view.show()
    }
  }, [editModal, renameModal])

  // Focus trap for edit modal
  useEffect(() => {
    if (!editModal) return

    const modal = editModalRef.current
    if (!modal) return

    const focusableSelector = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusableElements = modal.querySelectorAll<HTMLElement>(focusableSelector)
    const firstFocusable = focusableElements[0]
    const lastFocusable = focusableElements[focusableElements.length - 1]

    firstFocusable?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault()
            lastFocusable?.focus()
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault()
            firstFocusable?.focus()
          }
        }
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [editModal])

  // Focus trap for rename modal
  useEffect(() => {
    if (!renameModal) return

    const modal = renameModalRef.current
    if (!modal) return

    const focusableSelector = 'input, button, select, textarea, [tabindex]:not([tabindex="-1"])'
    const focusableElements = modal.querySelectorAll<HTMLElement>(focusableSelector)
    const firstFocusable = focusableElements[0]
    const lastFocusable = focusableElements[focusableElements.length - 1]

    firstFocusable?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault()
            lastFocusable?.focus()
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault()
            firstFocusable?.focus()
          }
        }
      }
    }

    modal.addEventListener('keydown', handleKeyDown)
    return () => modal.removeEventListener('keydown', handleKeyDown)
  }, [renameModal])

  // Listen for IPC events from main process - only once
  useEffect(() => {
    const unsubOpenNewTab = window.electron.on('bookmark:open-new-tab', (...args: unknown[]) => {
      const url = args[0] as string
      addTabRef.current(url)
    })

    const unsubEdit = window.electron.on('bookmark:edit', (...args: unknown[]) => {
      const data = args[0]
      // Runtime validation
      if (!data || typeof data !== 'object') {
        log.error('Invalid bookmark:edit data:', data)
        return
      }
      const bookmark = data as { id: string; title: string; url: string }
      if (!bookmark.id || !bookmark.title || !bookmark.url) {
        log.error('Missing required fields in bookmark:edit')
        return
      }
      setEditModal({
        bookmark: {
          id: bookmark.id,
          title: bookmark.title,
          url: bookmark.url,
          folderId: null,
          order: 0,
          createdAt: Date.now(),
        },
        name: bookmark.title,
        url: bookmark.url,
      })
    })

    const unsubDelete = window.electron.on('bookmark:delete', (...args: unknown[]) => {
      const id = args[0] as string
      removeBookmarkRef.current(id)
    })

    const unsubFolderRename = window.electron.on('folder:rename', (...args: unknown[]) => {
      const { folderId, folderName } = args[0] as { folderId: string; folderName: string }
      setRenameModal({ folderId, name: folderName })
    })

    const unsubFolderDelete = window.electron.on('folder:delete', (...args: unknown[]) => {
      const folderId = args[0] as string
      if (confirm('Delete this folder? Bookmarks will be moved to unfiled.')) {
        removeFolderRef.current(folderId)
      }
    })

    const unsubFolderOpenAll = window.electron.on('folder:open-all', (...args: unknown[]) => {
      const folderId = args[0] as string
      const bookmarks = getBookmarksByFolderRef.current(folderId)
      bookmarks.forEach((b) => addTabRef.current(b.url))
    })

    return () => {
      unsubOpenNewTab()
      unsubEdit()
      unsubDelete()
      unsubFolderRename()
      unsubFolderDelete()
      unsubFolderOpenAll()
    }
  }, []) // Empty deps - all callbacks use refs or state setters

  if (!proxyConnected || (bookmarks.length === 0 && folders.length === 0)) return null

  // Get top-level items (bookmarks without folder + top-level folders)
  const topLevelBookmarks = getBookmarksByFolder(null)
  const topLevelFolders = getSubfolders(null)

  const handleContextMenu = (e: React.MouseEvent, bookmark: Bookmark) => {
    e.preventDefault()
    window.electron.showBookmarkMenu(bookmark.id, bookmark.title, bookmark.url)
  }

  const handleFolderClick = (folderId: string) => {
    const folderBookmarks = getBookmarksByFolder(folderId)
    // Convert to simple objects for IPC
    const bookmarksData = folderBookmarks.map((b) => ({
      id: b.id,
      title: b.title,
      url: b.url,
    }))
    window.electron.showFolderMenu(folderId, bookmarksData)
  }

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string, folderName: string) => {
    e.preventDefault()
    e.stopPropagation() // Prevent normal click dropdown
    window.electron.showFolderContextMenu(folderId, folderName)
  }

  const closeEditModal = () => {
    setEditModal(null)
  }

  const handleSaveEdit = () => {
    if (editModal) {
      updateBookmark(editModal.bookmark.id, {
        title: editModal.name.trim() || editModal.bookmark.title,
        url: editModal.url.trim() || editModal.bookmark.url,
      })
      closeEditModal()
    }
  }

  // Drag & drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    // Check if dragging a folder
    const isActiveFolder = activeId.startsWith('folder-')
    const isOverFolder = overId.startsWith('folder-') || overId.startsWith('droppable-')

    // Case 1: Reordering folders
    if (isActiveFolder && isOverFolder && activeId !== overId) {
      const actualOverId = overId.startsWith('droppable-') ? overId.replace('droppable-', '') : overId

      if (activeId === actualOverId) return

      const oldIndex = topLevelFolders.findIndex((f) => f.id === activeId)
      const newIndex = topLevelFolders.findIndex((f) => f.id === actualOverId)

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderFolders(activeId, newIndex, null)
      }
      return
    }

    // Case 2: Dropping bookmark on a folder
    if (!isActiveFolder && over.data.current?.type === 'folder') {
      const targetFolderId = over.data.current.folderId
      reorderBookmarks(activeId, targetFolderId, 0)
      return
    }

    // Case 3: Reordering bookmarks in the bar
    if (!isActiveFolder && !isOverFolder && activeId !== overId) {
      const oldIndex = topLevelBookmarks.findIndex((b) => b.id === activeId)
      const newIndex = topLevelBookmarks.findIndex((b) => b.id === overId)

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderBookmarks(activeId, null, newIndex)
      }
    }
  }

  // Get active item for drag overlay
  const getActiveItem = () => {
    if (!activeId) return null

    const bookmark = topLevelBookmarks.find((b) => b.id === activeId)
    if (bookmark) return { type: 'bookmark', item: bookmark }

    const folder = topLevelFolders.find((f) => f.id === activeId)
    if (folder) return { type: 'folder', item: folder }

    return null
  }

  const activeItem = getActiveItem()

  return (
    <ErrorBoundary>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements: {
            onDragStart({ active }) {
              const bookmark = topLevelBookmarks.find((b) => b.id === active.id)
              if (bookmark) return `Picked up bookmark: ${bookmark.title}`

              const folder = topLevelFolders.find((f) => f.id === active.id)
              if (folder) return `Picked up folder: ${folder.name}`

              return 'Picked up draggable item'
            },
            onDragOver({ active, over }) {
              if (!over) return ''

              const activeBookmark = topLevelBookmarks.find((b) => b.id === active.id)
              const overBookmark = topLevelBookmarks.find((b) => b.id === over.id)
              const overFolder = topLevelFolders.find((f) => f.id === over.id || `droppable-${f.id}` === over.id)

              if (activeBookmark && overBookmark) {
                return `Bookmark ${activeBookmark.title} is over ${overBookmark.title}`
              }
              if (activeBookmark && overFolder) {
                return `Bookmark ${activeBookmark.title} is over folder ${overFolder.name}`
              }
              return ''
            },
            onDragEnd({ active, over }) {
              if (!over) return 'Dragging cancelled'

              const activeBookmark = topLevelBookmarks.find((b) => b.id === active.id)
              const overFolder = topLevelFolders.find((f) => f.id === over.id || `droppable-${f.id}` === over.id)

              if (activeBookmark && overFolder) {
                return `Bookmark ${activeBookmark.title} moved to folder ${overFolder.name}`
              }
              if (activeBookmark) {
                return `Bookmark ${activeBookmark.title} reordered`
              }
              return 'Item dropped'
            },
            onDragCancel({ active }) {
              const bookmark = topLevelBookmarks.find((b) => b.id === active.id)
              if (bookmark) return `Dragging cancelled. Bookmark ${bookmark.title} returned to original position.`

              const folder = topLevelFolders.find((f) => f.id === active.id)
              if (folder) return `Dragging cancelled. Folder ${folder.name} returned to original position.`

              return 'Dragging cancelled'
            },
          },
        }}
      >
        <div className="flex items-center gap-1.5 px-2 pt-1 pb-2 overflow-x-auto">
          {/* Sortable bookmarks context */}
          <SortableContext items={topLevelBookmarks.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
            {topLevelBookmarks.map((bookmark) => (
              <SortableBookmarkItem
                key={bookmark.id}
                bookmark={bookmark}
                onNavigate={navigateActiveTab}
                onContextMenu={handleContextMenu}
              />
            ))}
          </SortableContext>

          {/* Sortable folders context */}
          <SortableContext items={topLevelFolders.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
            {topLevelFolders.map((folder) => (
              <DroppableFolder
                key={folder.id}
                folder={folder}
                onClick={() => handleFolderClick(folder.id)}
                onContextMenu={(e) => handleFolderContextMenu(e, folder.id, folder.name)}
              />
            ))}
          </SortableContext>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeItem && activeItem.type === 'bookmark' && (
            <div className="px-2.5 py-1.5 rounded-full text-sm bg-surface text-foreground shadow-2xl opacity-90 flex items-center gap-2 border border-border-medium">
              <span>{(activeItem.item as Bookmark).title}</span>
            </div>
          )}
          {activeItem && activeItem.type === 'folder' && (
            <div className="px-3 py-1.5 rounded-full text-sm bg-surface text-foreground shadow-2xl opacity-90 border border-border-medium">
              {(activeItem.item as BookmarkFolder).name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Edit Modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={closeEditModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-bookmark-title"
        >
          <div
            ref={editModalRef}
            className="rounded-2xl p-5 w-full max-w-sm mx-4 bg-background/85 backdrop-blur-xl border border-border-medium shadow-2xl font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="edit-bookmark-title" className="text-foreground font-bold mb-4">
              Edit bookmark
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-muted-foreground text-xs block mb-1">Name</label>
                <input
                  value={editModal.name}
                  onChange={(e) => setEditModal({ ...editModal, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-muted-foreground text-xs block mb-1">URL</label>
                <input
                  value={editModal.url}
                  onChange={(e) => setEditModal({ ...editModal, url: e.target.value })}
                  className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
                onClick={closeEditModal}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] bg-primary/90 text-foreground shadow-primary/40 shadow-lg"
                onClick={handleSaveEdit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setRenameModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-folder-title"
        >
          <div
            ref={renameModalRef}
            className="rounded-2xl p-5 w-full max-w-sm mx-4 bg-background/85 backdrop-blur-xl border border-border-medium shadow-2xl font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rename-folder-title" className="text-foreground font-bold mb-4">
              Rename folder
            </h3>
            <input
              value={renameModal.name}
              onChange={(e) => setRenameModal({ ...renameModal, name: e.target.value })}
              className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (renameModal.name.trim()) {
                    updateFolder(renameModal.folderId, { name: renameModal.name.trim() })
                  }
                  setRenameModal(null)
                } else if (e.key === 'Escape') {
                  setRenameModal(null)
                }
              }}
            />
            <div className="flex gap-3 mt-5">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
                onClick={() => setRenameModal(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] bg-primary/90 text-foreground shadow-primary/40 shadow-lg"
                onClick={() => {
                  if (renameModal.name.trim()) {
                    updateFolder(renameModal.folderId, { name: renameModal.name.trim() })
                  }
                  setRenameModal(null)
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  )
}
