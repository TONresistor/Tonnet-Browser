/**
 * Bookmarks toolbar.
 * Displays and manages saved bookmarks with folder support.
 * Includes drag & drop functionality for reordering.
 */

import { useState } from 'react'
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
import { useBookmarksStore, Bookmark, BookmarkFolder } from '@/features/bookmarks/store'
import { useTabsStore } from '@/stores/tabs'
import { ErrorBoundary } from '../ErrorBoundary'
import { SortableBookmarkItem } from './SortableBookmarkItem'
import { DroppableFolder } from './DroppableFolder'
import { classifyDrop } from '@/lib/bookmark-dnd'
import { useBookmarkContextMenu } from '@/hooks/useBookmarkContextMenu'
import { useTranslation } from 'react-i18next'

export function BookmarksBar() {
  const { t } = useTranslation('settings')
  const { t: tBrowser } = useTranslation('browser')
  const bookmarks = useBookmarksStore((s) => s.bookmarks)
  const folders = useBookmarksStore((s) => s.folders)
  const reorderBookmarks = useBookmarksStore((s) => s.reorderBookmarks)
  const reorderFolders = useBookmarksStore((s) => s.reorderFolders)
  const navigateActiveTab = useTabsStore((s) => s.navigateActiveTab)
  const [activeId, setActiveId] = useState<string | null>(null)
  const {
    handleBookmarkContextMenu,
    handleFolderClick,
    handleFolderContextMenu,
    pendingFolderDeleteId,
    confirmFolderDelete,
    cancelFolderDelete,
  } = useBookmarkContextMenu()

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

  if (bookmarks.length === 0 && folders.length === 0) return null

  // Compute top-level items directly from selected state (not via get())
  const topLevelBookmarks = bookmarks.filter((b) => b.folderId === null).sort((a, b) => a.order - b.order)
  const topLevelFolders = folders.filter((f) => f.parentId === null).sort((a, b) => a.order - b.order)

  // Drag & drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    const action = classifyDrop(active, over, topLevelFolders, topLevelBookmarks)
    switch (action.kind) {
      case 'reorder-folder':
        reorderFolders(action.folderId, action.newIndex, null)
        break
      case 'bookmark-into-folder':
        reorderBookmarks(action.bookmarkId, action.folderId, 0)
        break
      case 'reorder-bookmark':
        reorderBookmarks(action.bookmarkId, null, action.newIndex)
        break
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
                onContextMenu={handleBookmarkContextMenu}
              />
            ))}
          </SortableContext>

          <SortableContext items={topLevelFolders.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
            {topLevelFolders.map((folder) => (
              <DroppableFolder
                key={folder.id}
                folder={folder}
                onClick={(e) => handleFolderClick(e, folder.id)}
                onContextMenu={(e) => handleFolderContextMenu(e, folder.id, folder.name)}
              />
            ))}
          </SortableContext>
        </div>

        <DragOverlay>
          {activeItem && activeItem.type === 'bookmark' && (
            <div className="px-2.5 py-1.5 rounded-full text-sm bg-surface text-chrome-foreground shadow-2xl opacity-90 flex items-center gap-2 border border-border-medium">
              <span>{(activeItem.item as Bookmark).title}</span>
            </div>
          )}
          {activeItem && activeItem.type === 'folder' && (
            <div className="px-3 py-1.5 rounded-full text-sm bg-surface text-chrome-foreground shadow-2xl opacity-90 border border-border-medium">
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
            onClick={confirmFolderDelete}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/25 hover:bg-destructive/40 transition-colors"
          >
            {t('bookmarks.confirm')}
          </button>
          <button
            onClick={cancelFolderDelete}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-hover hover:bg-surface-active transition-colors text-chrome-foreground"
          >
            {t('bookmarks.cancel')}
          </button>
        </div>
      )}
    </ErrorBoundary>
  )
}
