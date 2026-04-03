/**
 * Bookmark persistence management.
 * Load, save, and cache bookmarks to a JSON file on disk.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { DEFAULT_BOOKMARKS } from '../../shared/constants'
import { createLogger } from '../../shared/logger'

const log = createLogger('bookmarks')

export interface BookmarkFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  order: number
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  folderId: string | null
  createdAt: number
  order: number
}

export interface BookmarksData {
  bookmarks: Bookmark[]
  folders: BookmarkFolder[]
}

// File paths
let _basePath: string | undefined
export function setBasePath(path: string): void {
  _basePath = path
}
const getBookmarksDir = () => _basePath ?? join(app.getPath('userData'))
export const getBookmarksFile = () => join(getBookmarksDir(), 'bookmarks.json')

function createDefaultBookmarks(): Bookmark[] {
  return DEFAULT_BOOKMARKS.map((b, idx) => ({
    ...b,
    folderId: null,
    order: idx,
  }))
}

const DEFAULT_DATA: BookmarksData = {
  bookmarks: createDefaultBookmarks(),
  folders: [],
}

// In-memory cache
let bookmarksCache: BookmarksData | null = null

// Load bookmarks from disk
export function loadBookmarks(): BookmarksData {
  if (bookmarksCache) {
    return bookmarksCache
  }

  const bookmarksFile = getBookmarksFile()

  if (!existsSync(bookmarksFile)) {
    bookmarksCache = { bookmarks: createDefaultBookmarks(), folders: [] }
    saveBookmarks(bookmarksCache)
    return bookmarksCache
  }

  try {
    const raw = readFileSync(bookmarksFile, 'utf-8')
    if (!raw.trim()) {
      bookmarksCache = { bookmarks: createDefaultBookmarks(), folders: [] }
      saveBookmarks(bookmarksCache)
      return bookmarksCache
    }

    const parsed = JSON.parse(raw)

    // Support old Zustand persist format { state: { bookmarks, folders }, version }
    const data = parsed.state ?? parsed

    let bookmarks: Bookmark[] = data.bookmarks
    const folders: BookmarkFolder[] = data.folders ?? []

    if (!bookmarks || bookmarks.length === 0) {
      bookmarksCache = { bookmarks: createDefaultBookmarks(), folders: [] }
      saveBookmarks(bookmarksCache)
      return bookmarksCache
    }

    // Migration: fix old folderId values and add missing fields
    bookmarks = bookmarks.map((b: Bookmark, idx: number) => ({
      ...b,
      folderId:
        b.folderId === ('folder-ton' as string) || b.folderId === ('folder-unsorted' as string)
          ? null
          : (b.folderId ?? null),
      order: b.order ?? idx,
    }))

    // Migration: remove old default folders
    const cleanFolders = folders.filter((f: BookmarkFolder) => f.id !== 'folder-ton' && f.id !== 'folder-unsorted')

    bookmarksCache = { bookmarks, folders: cleanFolders }
    return bookmarksCache
  } catch (error) {
    log.error(`Failed to load bookmarks: ${String(error)}`)
    bookmarksCache = { bookmarks: createDefaultBookmarks(), folders: [] }
    return bookmarksCache
  }
}

// Save bookmarks to disk (atomic write)
export function saveBookmarks(data: BookmarksData): void {
  const bookmarksFile = getBookmarksFile()
  const tempFile = bookmarksFile + '.tmp'
  const dir = getBookmarksDir()

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  try {
    writeFileSync(tempFile, JSON.stringify(data, null, 2))
    renameSync(tempFile, bookmarksFile)
    bookmarksCache = data
  } catch (error) {
    log.error(`Failed to save bookmarks: ${String(error)}`)
    try {
      unlinkSync(tempFile)
    } catch {
      /* ignore cleanup failure */
    }
  }
}
