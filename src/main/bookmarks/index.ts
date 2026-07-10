/** Bookmark persistence through a versioned, async repository. */

import { app } from 'electron'
import { join } from 'node:path'
import { DEFAULT_BOOKMARKS } from '../../shared/constants'
import { createLogger } from '../../shared/logger'
import {
  BookmarkFolderSchema,
  BookmarkSchema,
  BookmarksDataSchema,
  type Bookmark,
  type BookmarksData,
} from '../../shared/ipc-contract/bookmarks'
import { VersionedJsonRepository } from '../persistence/versioned-json-repository'

const log = createLogger('bookmarks')
const SCHEMA_VERSION = 1

export type { Bookmark, BookmarkFolder, BookmarksData } from '../../shared/ipc-contract/bookmarks'

export const getBookmarksFile = () => join(app.getPath('userData'), 'bookmarks.json')

function createDefaultBookmarks(): Bookmark[] {
  return DEFAULT_BOOKMARKS.map((bookmark, order) => ({ ...bookmark, folderId: null, order }))
}

function defaults(): BookmarksData {
  return { bookmarks: createDefaultBookmarks(), folders: [] }
}

function migrateBookmarks(raw: unknown): BookmarksData {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const legacyState = root.state && typeof root.state === 'object' ? (root.state as Record<string, unknown>) : root
  const rawBookmarks = Array.isArray(legacyState.bookmarks) ? legacyState.bookmarks : []
  const rawFolders = Array.isArray(legacyState.folders) ? legacyState.folders : []

  const bookmarks = rawBookmarks.flatMap((value, order) => {
    if (!value || typeof value !== 'object') return []
    const bookmark = value as Record<string, unknown>
    const migrated = {
      ...bookmark,
      folderId:
        bookmark.folderId === 'folder-ton' || bookmark.folderId === 'folder-unsorted'
          ? null
          : (bookmark.folderId ?? null),
      createdAt: bookmark.createdAt ?? 0,
      order: bookmark.order ?? order,
    }
    const parsed = BookmarkSchema.safeParse(migrated)
    return parsed.success ? [parsed.data] : []
  })

  const folders = rawFolders.flatMap((value, order) => {
    if (!value || typeof value !== 'object') return []
    const folder = value as Record<string, unknown>
    if (folder.id === 'folder-ton' || folder.id === 'folder-unsorted') return []
    const parsed = BookmarkFolderSchema.safeParse({
      ...folder,
      parentId: folder.parentId ?? null,
      createdAt: folder.createdAt ?? 0,
      order: folder.order ?? order,
    })
    return parsed.success ? [parsed.data] : []
  })

  return bookmarks.length > 0 ? { bookmarks, folders } : defaults()
}

let repository: VersionedJsonRepository<BookmarksData> | null = null
let bookmarksCache: BookmarksData | null = null

function getRepository(): VersionedJsonRepository<BookmarksData> {
  repository ??= new VersionedJsonRepository({
    filePath: getBookmarksFile(),
    version: SCHEMA_VERSION,
    schema: BookmarksDataSchema,
    defaults,
    migrate: migrateBookmarks,
    corruption: 'reset-with-backup',
    onCorrupt: (error, backupPath) => log.error(`Corrupt bookmarks quarantined at ${backupPath}: ${String(error)}`),
  })
  return repository
}

export async function loadBookmarks(): Promise<BookmarksData> {
  if (bookmarksCache) return bookmarksCache
  try {
    bookmarksCache = await getRepository().load()
  } catch (error) {
    log.error(`Failed to load bookmarks: ${String(error)}`)
    bookmarksCache = defaults()
  }
  return bookmarksCache
}

export async function saveBookmarks(data: BookmarksData): Promise<void> {
  try {
    await getRepository().save(data)
    bookmarksCache = data
  } catch (error) {
    log.error(`Failed to save bookmarks: ${String(error)}`)
    throw error
  }
}
