/**
 * Bookmark context-menu controller (OPP-67).
 *
 * Owns the overlay menu ref, the in-flight edit/rename refs, the last
 * right-click position, and the pending folder-delete confirmation. Exposes
 * the right-click handlers for bookmarks/folders plus confirm/cancel for the
 * folder-delete prompt, so BookmarksBar stays focused on layout + drag-drop.
 */
import { useState, useRef, useCallback, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { UI_NOTIFICATION_TIMEOUT_MS } from '@shared/constants'
import type { OverlayMenuItem } from '@shared/types'
import { useBookmarksStore, type Bookmark } from '@/stores/bookmarks'
import { useTabsStore } from '@/stores/tabs'
import { clampToViewport } from '@/lib/overlay-position'
import { useOverlay } from './useOverlay'

export interface BookmarkContextMenu {
  handleBookmarkContextMenu: (e: MouseEvent, bookmark: Bookmark) => void
  handleFolderClick: (e: MouseEvent, folderId: string) => void
  handleFolderContextMenu: (e: MouseEvent, folderId: string, folderName: string) => void
  pendingFolderDeleteId: string | null
  confirmFolderDelete: () => void
  cancelFolderDelete: () => void
}

export function useBookmarkContextMenu(): BookmarkContextMenu {
  const { t } = useTranslation('settings')
  const getBookmarksByFolder = useBookmarksStore((s) => s.getBookmarksByFolder)
  const updateBookmark = useBookmarksStore((s) => s.updateBookmark)
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark)
  const updateFolder = useBookmarksStore((s) => s.updateFolder)
  const removeFolder = useBookmarksStore((s) => s.removeFolder)
  const navigateActiveTab = useTabsStore((s) => s.navigateActiveTab)
  const addTab = useTabsStore((s) => s.addTab)

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

  const handleBookmarkContextMenu = useCallback(
    (e: MouseEvent, bookmark: Bookmark) => {
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

  const handleFolderClick = (e: MouseEvent, folderId: string): void => {
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

  const handleFolderContextMenu = (e: MouseEvent, folderId: string, folderName: string): void => {
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

  const confirmFolderDelete = (): void => {
    if (pendingFolderDeleteId) removeFolder(pendingFolderDeleteId)
    setPendingFolderDeleteId(null)
    if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
  }

  const cancelFolderDelete = (): void => {
    setPendingFolderDeleteId(null)
    if (folderDeleteTimerRef.current) clearTimeout(folderDeleteTimerRef.current)
  }

  return {
    handleBookmarkContextMenu,
    handleFolderClick,
    handleFolderContextMenu,
    pendingFolderDeleteId,
    confirmFolderDelete,
    cancelFolderDelete,
  }
}
