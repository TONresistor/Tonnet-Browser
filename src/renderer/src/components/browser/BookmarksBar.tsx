/**
 * Bookmarks toolbar.
 * Displays and manages saved bookmarks with folder support.
 * Includes drag & drop functionality for reordering.
 */

import { useState, useRef, useCallback } from 'react'
import { UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'
import type { OverlayMenuItem } from '@shared/types'
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
import { clampToViewport } from '@/lib/overlay-position'
import { useTranslation } from 'react-i18next'
import { useOverlay } from '@/hooks/useOverlay'

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
  const navigateActiveTab = useTabsStore((s) => s.navigateActiveTab)
  const addTab = useTabsStore((s) => s.addTab)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [pendingFolderDeleteId, setPendingFolderDeleteId] = useState<string | null>(null)
  const folderDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editingBookmarkIdRef = useRef<string | null>(null)
  const editingFolderIdRef = useRef<string | null>(null)
  const lastClickPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const menuRef = useRef<{
    show: (
      bounds: { x: number; y: number; width: number; height: number },
      content: { type: string; [key: string]: unknown }
    ) => void
    hide: () => void
  } | null>(null)

  // Overlay menu action handler
  const handleMenuAction = useCallback(
    (actionType: string, data: unknown) => {
      const d = data as Record<string, string>
      switch (actionType) {
        case 'open-new-tab':
          menuRef.current?.hide()
          addTab(d.url)
          break
        case 'navigate':
          menuRef.current?.hide()
          navigateActiveTab(d.url)
          break
        case 'edit': {
          // Transition menu -> form, positioned below the original right-click, clamped to window
          editingBookmarkIdRef.current = d.id
          const editW = 320,
            editH = 270
          const { x: editX, y: editY } = clampToViewport(
            lastClickPosRef.current.x - editW / 2,
            lastClickPosRef.current.y + 8,
            editW,
            editH
          )
          menuRef.current?.show(
            { x: Math.round(editX), y: Math.round(editY), width: editW, height: editH },
            {
              type: 'form',
              title: t('bookmarks.editBookmark'),
              fields: [
                { id: 'name', label: t('bookmarks.name'), value: d.title },
                { id: 'url', label: t('bookmarks.url'), value: d.url },
              ],
              actions: [
                { id: 'dismiss', label: t('bookmarks.cancel') },
                { id: 'save-edit', label: t('bookmarks.save'), primary: true },
              ],
            }
          )
          break
        }
        case 'save-edit':
          menuRef.current?.hide()
          if (editingBookmarkIdRef.current) {
            updateBookmark(editingBookmarkIdRef.current, {
              title: (d.name as string)?.trim() || '',
              url: (d.url as string)?.trim() || '',
            })
            editingBookmarkIdRef.current = null
          }
          break
        case 'delete-bookmark':
          menuRef.current?.hide()
          removeBookmark(d.id)
          break
        case 'rename-folder': {
          // Transition menu -> form, positioned below the original right-click, clamped to window
          editingFolderIdRef.current = d.folderId
          const renameW = 320,
            renameH = 170
          const { x: renameX, y: renameY } = clampToViewport(
            lastClickPosRef.current.x - renameW / 2,
            lastClickPosRef.current.y + 8,
            renameW,
            renameH
          )
          menuRef.current?.show(
            { x: Math.round(renameX), y: Math.round(renameY), width: renameW, height: renameH },
            {
              type: 'form',
              title: t('bookmarks.renameFolder'),
              fields: [{ id: 'name', label: t('bookmarks.name'), value: d.folderName }],
              actions: [
                { id: 'dismiss', label: t('bookmarks.cancel') },
                { id: 'save-rename', label: t('bookmarks.save'), primary: true },
              ],
            }
          )
          break
        }
        case 'save-rename':
          menuRef.current?.hide()
          if (editingFolderIdRef.current) {
            updateFolder(editingFolderIdRef.current, { name: (d.name as string)?.trim() || '' })
            editingFolderIdRef.current = null
          }
          break
        case 'open-all':
          menuRef.current?.hide()
          getBookmarksByFolder(d.folderId).forEach((b) => addTab(b.url))
          break
        case 'delete-folder':
          menuRef.current?.hide()
          setPendingFolderDeleteId(d.folderId)
          if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
          folderDeleteTimerRef.current = setTimeout(() => setPendingFolderDeleteId(null), UI_NOTIFICATION_TIMEOUT_MS)
          break
        case 'dismiss':
          menuRef.current?.hide()
          break
      }
    },
    [addTab, navigateActiveTab, removeBookmark, getBookmarksByFolder, updateBookmark, updateFolder, t]
  )

  const menu = useOverlay('bookmark-menu', handleMenuAction)
  menuRef.current = menu

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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, bookmark: Bookmark) => {
      e.preventDefault()
      lastClickPosRef.current = { x: e.clientX, y: e.clientY }
      const menuW = 200,
        menuH = 160
      const { x: menuX, y: menuY } = clampToViewport(e.clientX, e.clientY, menuW, menuH)
      const items: OverlayMenuItem[] = [
        { id: 'open-new-tab', label: t('bookmarks.openInNewTab'), data: { url: bookmark.url } },
        {
          id: 'edit',
          label: t('bookmarks.edit'),
          data: { id: bookmark.id, title: bookmark.title, url: bookmark.url },
        },
        { id: '_sep1', label: '', separator: true },
        { id: 'delete-bookmark', label: t('bookmarks.delete'), data: { id: bookmark.id }, destructive: true },
      ]
      menuRef.current?.show({ x: menuX, y: menuY, width: menuW, height: menuH }, { type: 'menu', items })
    },
    [t]
  )

  if (bookmarks.length === 0 && folders.length === 0) return null

  // Compute top-level items directly from selected state (not via get())
  const topLevelBookmarks = bookmarks.filter((b) => b.folderId === null).sort((a, b) => a.order - b.order)
  const topLevelFolders = folders.filter((f) => f.parentId === null).sort((a, b) => a.order - b.order)

  const handleFolderClick = (e: React.MouseEvent, folderId: string) => {
    const folderBookmarks = getBookmarksByFolder(folderId)
    const items: OverlayMenuItem[] = folderBookmarks.map((b) => ({
      id: 'navigate',
      label: b.title || b.url,
      data: { url: b.url },
    }))
    if (items.length === 0) {
      items.push({
        id: 'empty',
        label: t('bookmarks.emptyFolder'),
        disabled: true,
        data: {},
      })
    }
    const target = e.currentTarget.getBoundingClientRect()
    menu.show(
      {
        x: Math.round(target.left),
        y: Math.round(target.bottom + 4),
        width: 220,
        height: Math.min(items.length * 40 + 8, 300),
      },
      { type: 'menu', items }
    )
  }

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string, folderName: string) => {
    e.preventDefault()
    e.stopPropagation()
    lastClickPosRef.current = { x: e.clientX, y: e.clientY }
    const fMenuW = 200,
      fMenuH = 160
    const { x: fMenuX, y: fMenuY } = clampToViewport(e.clientX, e.clientY, fMenuW, fMenuH)
    const items: OverlayMenuItem[] = [
      { id: 'rename-folder', label: t('bookmarks.rename'), data: { folderId, folderName } },
      { id: 'open-all', label: t('bookmarks.openAllBookmarks'), data: { folderId } },
      { id: '_sep1', label: '', separator: true },
      { id: 'delete-folder', label: t('bookmarks.delete'), data: { folderId }, destructive: true },
    ]
    menu.show({ x: fMenuX, y: fMenuY, width: fMenuW, height: fMenuH }, { type: 'menu', items })
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
                onClick={(e) => handleFolderClick(e, folder.id)}
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
              removeFolder(pendingFolderDeleteId)
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
    </ErrorBoundary>
  )
}
