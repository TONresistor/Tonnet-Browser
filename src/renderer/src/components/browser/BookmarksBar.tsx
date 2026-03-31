/**
 * Bookmarks toolbar.
 * Displays and manages saved bookmarks with folder support.
 * Includes drag & drop functionality for reordering.
 */

import { useState, useEffect, useRef } from 'react'
import { createLogger } from '@/logger'
import { UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'

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
import { useTabsStore } from '@/stores/tabs'
import { ErrorBoundary } from '../ErrorBoundary'
import { SortableBookmarkItem } from './SortableBookmarkItem'
import { DroppableFolder } from './DroppableFolder'
import { BookmarkEditModal } from './BookmarkEditModal'
import { BookmarkRenameModal } from './BookmarkRenameModal'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('settings')
  const { t: tBrowser } = useTranslation('browser')
  const bookmarks = useBookmarksStore((s) => s.bookmarks)
  const folders = useBookmarksStore((s) => s.folders)
  const getBookmarksByFolder = useBookmarksStore((s) => s.getBookmarksByFolder)
  const updateBookmark = useBookmarksStore((s) => s.updateBookmark)
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark)
  const updateFolder = useBookmarksStore((s) => s.updateFolder)
  const removeFolder = useBookmarksStore((s) => s.removeFolder)
  const reorderBookmarks = useBookmarksStore((s) => s.reorderBookmarks)
  const reorderFolders = useBookmarksStore((s) => s.reorderFolders)
  const { navigateActiveTab, addTab } = useTabsStore()
  const [editModal, setEditModal] = useState<EditModal | null>(null)
  const [renameModal, setRenameModal] = useState<RenameModal | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingFolderDeleteId, setPendingFolderDeleteId] = useState<string | null>(null)
  const folderDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setPendingFolderDeleteId(folderId)
      if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
      folderDeleteTimerRef.current = setTimeout(() => setPendingFolderDeleteId(null), UI_NOTIFICATION_TIMEOUT_MS)
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
      if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
    }
  }, []) // Empty deps - all callbacks use refs or state setters

  if (bookmarks.length === 0 && folders.length === 0) return null

  // Compute top-level items directly from selected state (not via get())
  const topLevelBookmarks = bookmarks.filter((b) => b.folderId === null).sort((a, b) => a.order - b.order)
  const topLevelFolders = folders.filter((f) => f.parentId === null).sort((a, b) => a.order - b.order)

  const handleContextMenu = (e: React.MouseEvent, bookmark: Bookmark) => {
    e.preventDefault()
    window.electron.showBookmarkMenu(bookmark.id, bookmark.title, bookmark.url)
  }

  const handleFolderClick = (folderId: string) => {
    const folderBookmarks = getBookmarksByFolder(folderId)
    const bookmarksData = folderBookmarks.map((b) => ({
      id: b.id,
      title: b.title,
      url: b.url,
    }))
    window.electron.showFolderMenu(folderId, bookmarksData)
  }

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string, folderName: string) => {
    e.preventDefault()
    e.stopPropagation()
    window.electron.showFolderContextMenu(folderId, folderName)
  }

  const closeEditModal = () => setEditModal(null)

  const handleSaveEdit = () => {
    if (editModal) {
      updateBookmark(editModal.bookmark.id, {
        title: editModal.name.trim() || editModal.bookmark.title,
        url: editModal.url.trim() || editModal.bookmark.url,
      })
      closeEditModal()
    }
  }

  const handleSaveRename = () => {
    if (renameModal) {
      if (renameModal.name.trim()) {
        updateFolder(renameModal.folderId, { name: renameModal.name.trim() })
      }
      setRenameModal(null)
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

    const isActiveFolder = activeId.startsWith('folder-')
    const isOverFolder = overId.startsWith('folder-') || overId.startsWith('droppable-')

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

    if (!isActiveFolder && over.data.current?.type === 'folder') {
      const targetFolderId = over.data.current.folderId
      reorderBookmarks(activeId, targetFolderId, 0)
      return
    }

    if (!isActiveFolder && !isOverFolder && activeId !== overId) {
      const oldIndex = topLevelBookmarks.findIndex((b) => b.id === activeId)
      const newIndex = topLevelBookmarks.findIndex((b) => b.id === overId)
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderBookmarks(activeId, null, newIndex)
      }
    }
  }

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
              if (bookmark) return tBrowser('dnd.pickedUp', { type: 'bookmark', name: bookmark.title })
              const folder = topLevelFolders.find((f) => f.id === active.id)
              if (folder) return tBrowser('dnd.pickedUp', { type: 'folder', name: folder.name })
              return tBrowser('dnd.pickedUp', { type: 'item', name: '' })
            },
            onDragOver({ active, over }) {
              if (!over) return ''
              const activeBookmark = topLevelBookmarks.find((b) => b.id === active.id)
              const overBookmark = topLevelBookmarks.find((b) => b.id === over.id)
              const overFolder = topLevelFolders.find((f) => f.id === over.id || `droppable-${f.id}` === over.id)
              if (activeBookmark && overBookmark) {
                return tBrowser('dnd.movedOver', { name: activeBookmark.title, target: overBookmark.title })
              }
              if (activeBookmark && overFolder) {
                return tBrowser('dnd.movedOver', { name: activeBookmark.title, target: overFolder.name })
              }
              return ''
            },
            onDragEnd({ active, over }) {
              if (!over) return tBrowser('dnd.cancelled')
              const activeBookmark = topLevelBookmarks.find((b) => b.id === active.id)
              const overFolder = topLevelFolders.find((f) => f.id === over.id || `droppable-${f.id}` === over.id)
              if (activeBookmark && overFolder) {
                return tBrowser('dnd.droppedOn', { name: activeBookmark.title, target: overFolder.name })
              }
              if (activeBookmark) {
                return tBrowser('dnd.droppedOn', { name: activeBookmark.title, target: '' })
              }
              return tBrowser('dnd.cancelled')
            },
            onDragCancel({ active }) {
              const bookmark = topLevelBookmarks.find((b) => b.id === active.id)
              if (bookmark) return tBrowser('dnd.cancelled', { name: bookmark.title })
              const folder = topLevelFolders.find((f) => f.id === active.id)
              if (folder) return tBrowser('dnd.cancelled', { name: folder.name })
              return tBrowser('dnd.cancelled')
            },
          },
        }}
      >
        <div className="flex items-center gap-1.5 px-2 pt-1 pb-2 overflow-x-auto">
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

      {/* Folder delete confirmation */}
      {pendingFolderDeleteId && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm bg-destructive/15 border-t border-destructive/30 text-destructive">
          <span className="flex-1">{t('bookmarks.deleteFolderConfirm')}</span>
          <button
            onClick={() => {
              removeFolderRef.current(pendingFolderDeleteId)
              setPendingFolderDeleteId(null)
              if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
            }}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/25 hover:bg-destructive/40 transition-colors"
          >
            {t('bookmarks.confirm')}
          </button>
          <button
            onClick={() => {
              setPendingFolderDeleteId(null)
              if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
            }}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-hover hover:bg-surface-active transition-colors text-muted-foreground"
          >
            {t('bookmarks.cancel')}
          </button>
        </div>
      )}

      {editModal && (
        <BookmarkEditModal
          editModal={editModal}
          onChangeModal={setEditModal}
          onSave={handleSaveEdit}
          onClose={closeEditModal}
        />
      )}

      {renameModal && (
        <BookmarkRenameModal
          renameModal={renameModal}
          onChangeModal={setRenameModal}
          onSave={handleSaveRename}
          onClose={() => setRenameModal(null)}
        />
      )}
    </ErrorBoundary>
  )
}
