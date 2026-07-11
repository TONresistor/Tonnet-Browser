import { describe, it, expect } from 'vitest'
import type { Active, Over } from '@dnd-kit/core'
import { classifyDrop } from '../bookmark-dnd'
import type { Bookmark, BookmarkFolder } from '@/features/bookmarks/store'

const folder = (id: string, order: number): BookmarkFolder =>
  ({ id, name: id, parentId: null, order }) as BookmarkFolder
const bookmark = (id: string, order: number): Bookmark =>
  ({ id, url: `https://${id}`, title: id, folderId: null, order }) as Bookmark

const active = (id: string): Active => ({ id, data: { current: undefined } }) as unknown as Active
const over = (id: string, data?: Record<string, unknown>): Over => ({ id, data: { current: data } }) as unknown as Over

const folders = [folder('folder-a', 0), folder('folder-b', 1)]
const bookmarks = [bookmark('b1', 0), bookmark('b2', 1)]

describe('classifyDrop', () => {
  it('returns none when there is no drop target', () => {
    expect(classifyDrop(active('b1'), null, folders, bookmarks)).toEqual({ kind: 'none' })
  })

  it('reorders folders when a folder is dropped on another folder', () => {
    expect(classifyDrop(active('folder-a'), over('folder-b'), folders, bookmarks)).toEqual({
      kind: 'reorder-folder',
      folderId: 'folder-a',
      newIndex: 1,
    })
  })

  it('strips the droppable- prefix when resolving the target folder', () => {
    expect(classifyDrop(active('folder-a'), over('droppable-folder-b'), folders, bookmarks)).toEqual({
      kind: 'reorder-folder',
      folderId: 'folder-a',
      newIndex: 1,
    })
  })

  it('returns none when a folder is dropped on itself (droppable prefix)', () => {
    expect(classifyDrop(active('folder-a'), over('droppable-folder-a'), folders, bookmarks)).toEqual({ kind: 'none' })
  })

  it('moves a bookmark into a folder when over carries folder data', () => {
    expect(
      classifyDrop(active('b1'), over('folder-a', { type: 'folder', folderId: 'folder-a' }), folders, bookmarks)
    ).toEqual({ kind: 'bookmark-into-folder', bookmarkId: 'b1', folderId: 'folder-a' })
  })

  it('reorders bookmarks when a bookmark is dropped on another bookmark', () => {
    expect(classifyDrop(active('b1'), over('b2'), folders, bookmarks)).toEqual({
      kind: 'reorder-bookmark',
      bookmarkId: 'b1',
      newIndex: 1,
    })
  })

  it('returns none when a bookmark is dropped on itself', () => {
    expect(classifyDrop(active('b1'), over('b1'), folders, bookmarks)).toEqual({ kind: 'none' })
  })

  it('returns none when the bookmark ids are unknown', () => {
    expect(classifyDrop(active('bX'), over('bY'), folders, bookmarks)).toEqual({ kind: 'none' })
  })
})
