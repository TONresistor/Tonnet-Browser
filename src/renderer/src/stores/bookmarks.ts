/**
 * Bookmarks store.
 * Persisted bookmark management with Zustand.
 * Supports hierarchical folders (max 3 levels).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BOOKMARKS } from '@shared/constants'

export interface BookmarkFolder {
  id: string
  name: string
  parentId: string | null  // null = root level
  createdAt: number
  order: number
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  folderId: string | null  // null = unfiled (root)
  createdAt: number
  order: number
}

interface BookmarksState {
  bookmarks: Bookmark[]
  folders: BookmarkFolder[]

  // Folder operations
  addFolder: (name: string, parentId: string | null) => string | null
  updateFolder: (id: string, data: { name?: string; parentId?: string | null }) => void
  removeFolder: (id: string) => void
  getFolderDepth: (folderId: string | null) => number
  getSubfolders: (parentId: string | null) => BookmarkFolder[]

  // Bookmark operations
  addBookmark: (url: string, title: string, folderId?: string | null, favicon?: string) => void
  updateBookmark: (id: string, data: { url?: string; title?: string; folderId?: string | null; favicon?: string }) => void
  removeBookmark: (id: string) => void
  moveBookmark: (bookmarkId: string, folderId: string | null) => void
  getBookmarksByFolder: (folderId: string | null) => Bookmark[]
  isBookmarked: (url: string) => boolean
  searchBookmarks: (query: string) => Bookmark[]

  // Reset
  resetBookmarks: () => void
}

const generateId = () => crypto.randomUUID()

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      // Default bookmarks are unfiled (folderId: null) - like Chrome
      bookmarks: DEFAULT_BOOKMARKS.map((b, idx) => ({
        ...b,
        folderId: null,
        order: idx,
      })),
      // No default folders - user creates them as needed
      folders: [],

      // Folder operations
      addFolder: (name, parentId) => {
        // Check depth limit (max 3 levels)
        const depth = get().getFolderDepth(parentId)
        if (depth >= 3) {
          return null // Max depth reached
        }

        const folder: BookmarkFolder = {
          id: `folder-${generateId()}`,
          name,
          parentId,
          createdAt: Date.now(),
          order: get().getSubfolders(parentId).length,
        }

        set((state) => ({
          folders: [...state.folders, folder],
        }))

        return folder.id
      },

      updateFolder: (id, data) => {
        set((state) => ({
          folders: state.folders.map((f) =>
            f.id === id ? { ...f, ...data } : f
          ),
        }))
      },

      removeFolder: (id) => {
        // Move bookmarks in this folder to unfiled
        set((state) => ({
          bookmarks: state.bookmarks.map((b) =>
            b.folderId === id ? { ...b, folderId: null } : b
          ),
          folders: state.folders.filter((f) => {
            // Remove folder and all subfolders
            if (f.id === id) return false
            // Check if parent chain includes deleted folder
            let current = f
            while (current.parentId) {
              if (current.parentId === id) return false
              const parent = state.folders.find((p) => p.id === current.parentId)
              if (!parent) break
              current = parent
            }
            return true
          }),
        }))
      },

      getFolderDepth: (folderId) => {
        if (!folderId) return 0
        const folder = get().folders.find((f) => f.id === folderId)
        if (!folder) return 0
        return 1 + get().getFolderDepth(folder.parentId)
      },

      getSubfolders: (parentId) => {
        return get()
          .folders.filter((f) => f.parentId === parentId)
          .sort((a, b) => a.order - b.order)
      },

      // Bookmark operations
      addBookmark: (url, title, folderId = null, favicon) => {
        if (get().isBookmarked(url)) return

        const bookmark: Bookmark = {
          id: generateId(),
          url,
          title,
          favicon,
          folderId,
          createdAt: Date.now(),
          order: get().getBookmarksByFolder(folderId).length,
        }

        set((state) => ({
          bookmarks: [...state.bookmarks, bookmark],
        }))
      },

      updateBookmark: (id, data) => {
        set((state) => ({
          bookmarks: state.bookmarks.map((b) =>
            b.id === id ? { ...b, ...data } : b
          ),
        }))
      },

      removeBookmark: (id) => {
        set((state) => ({
          bookmarks: state.bookmarks.filter((b) => b.id !== id),
        }))
      },

      moveBookmark: (bookmarkId, folderId) => {
        set((state) => ({
          bookmarks: state.bookmarks.map((b) =>
            b.id === bookmarkId ? { ...b, folderId } : b
          ),
        }))
      },

      getBookmarksByFolder: (folderId) => {
        return get()
          .bookmarks.filter((b) => b.folderId === folderId)
          .sort((a, b) => a.order - b.order)
      },

      isBookmarked: (url) => {
        return get().bookmarks.some((b) => b.url === url)
      },

      searchBookmarks: (query) => {
        if (!query.trim()) return get().bookmarks
        const q = query.toLowerCase()
        return get().bookmarks.filter((b) =>
          b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
        )
      },

      resetBookmarks: () => {
        set({
          bookmarks: DEFAULT_BOOKMARKS.map((b, idx) => ({
            ...b,
            folderId: null,
            order: idx,
          })),
          folders: [],
        })
      },
    }),
    {
      name: 'ton-browser-bookmarks',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<BookmarksState> | undefined

        // Migration: Add folderId and order to old bookmarks
        if (persisted?.bookmarks) {
          const migratedBookmarks = persisted.bookmarks.map((b, idx) => ({
            ...b,
            // Migrate old folder references to unfiled (null)
            folderId: (b.folderId === 'folder-ton' || b.folderId === 'folder-unsorted') ? null : (b.folderId ?? null),
            order: b.order ?? idx,
          }))
          persisted.bookmarks = migratedBookmarks
        }

        // Migration: Remove old default folders
        if (persisted?.folders) {
          persisted.folders = persisted.folders.filter(
            (f) => f.id !== 'folder-ton' && f.id !== 'folder-unsorted'
          )
        }

        // If no persisted data, use defaults
        if (!persisted?.bookmarks || persisted.bookmarks.length === 0) {
          return {
            ...currentState,
            bookmarks: DEFAULT_BOOKMARKS.map((b, idx) => ({
              ...b,
              folderId: null,
              order: idx,
            })),
            folders: [],
          }
        }

        return { ...currentState, ...persisted }
      },
    }
  )
)
