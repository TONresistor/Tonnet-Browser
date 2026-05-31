/**
 * Pure drag-and-drop classification for the bookmarks bar (OPP-67).
 *
 * Decides what a drop means (folder reorder / bookmark-into-folder /
 * bookmark reorder / nothing) without performing any side effects, so the
 * decision is unit-testable in isolation from the store and dnd-kit runtime.
 */
import type { Active, Over } from '@dnd-kit/core'
import type { Bookmark, BookmarkFolder } from '@/stores/bookmarks'

export type DropAction =
  | { kind: 'reorder-folder'; folderId: string; newIndex: number }
  | { kind: 'bookmark-into-folder'; bookmarkId: string; folderId: string }
  | { kind: 'reorder-bookmark'; bookmarkId: string; newIndex: number }
  | { kind: 'none' }

export function classifyDrop(
  active: Active,
  over: Over | null,
  topLevelFolders: BookmarkFolder[],
  topLevelBookmarks: Bookmark[]
): DropAction {
  if (!over) return { kind: 'none' }

  const activeId = active.id as string
  const overId = over.id as string

  const isActiveFolder = activeId.startsWith('folder-')
  const isOverFolder = overId.startsWith('folder-') || overId.startsWith('droppable-')

  if (isActiveFolder && isOverFolder && activeId !== overId) {
    const actualOverId = overId.startsWith('droppable-') ? overId.replace('droppable-', '') : overId
    if (activeId === actualOverId) return { kind: 'none' }
    const oldIndex = topLevelFolders.findIndex((f) => f.id === activeId)
    const newIndex = topLevelFolders.findIndex((f) => f.id === actualOverId)
    if (oldIndex !== -1 && newIndex !== -1) {
      return { kind: 'reorder-folder', folderId: activeId, newIndex }
    }
    return { kind: 'none' }
  }

  if (!isActiveFolder && over.data.current?.type === 'folder') {
    return { kind: 'bookmark-into-folder', bookmarkId: activeId, folderId: over.data.current.folderId as string }
  }

  if (!isActiveFolder && !isOverFolder && activeId !== overId) {
    const oldIndex = topLevelBookmarks.findIndex((b) => b.id === activeId)
    const newIndex = topLevelBookmarks.findIndex((b) => b.id === overId)
    if (oldIndex !== -1 && newIndex !== -1) {
      return { kind: 'reorder-bookmark', bookmarkId: activeId, newIndex }
    }
  }

  return { kind: 'none' }
}
