/**
 * Bookmarks store.
 * Persists to main-process JSON file via IPC (same pattern as settings).
 * Supports hierarchical folders (max 3 levels).
 */

import { create } from 'zustand'

export interface BookmarkFolder {
  id: string
  name: string
  parentId: string | null // null = root level
  createdAt: number
  order: number
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  folderId: string | null // null = unfiled (root)
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
  getFolderDepth: (folderId: string | null, visited?: Set<string>) => number
  getSubfolders: (parentId: string | null) => BookmarkFolder[]
  reorderFolders: (folderId: string, newIndex: number, parentId: string | null) => void

  // Bookmark operations
  addBookmark: (url: string, title: string, folderId?: string | null, favicon?: string) => void
  updateBookmark: (
    id: string,
    data: { url?: string; title?: string; folderId?: string | null; favicon?: string }
  ) => void
  removeBookmark: (id: string) => void
  moveBookmark: (bookmarkId: string, folderId: string | null) => void
  getBookmarksByFolder: (folderId: string | null) => Bookmark[]
  isBookmarked: (url: string) => boolean
  searchBookmarks: (query: string) => Bookmark[]
  reorderBookmarks: (bookmarkId: string, targetFolderId: string | null, newIndex: number) => void

  // Reset
  resetBookmarks: () => void
}

const generateId = () => crypto.randomUUID()

// Single-invocation create (no double ()() pattern, no persist middleware)
export const useBookmarksStore = create<BookmarksState>((set, get) => ({
  bookmarks: [],
  folders: [],

  // Folder operations
  addFolder: (name, parentId) => {
    const depth = get().getFolderDepth(parentId)
    if (depth >= 3) return null

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
      folders: state.folders.map((f) => (f.id === id ? { ...f, ...data } : f)),
    }))
  },

  removeFolder: (id) => {
    set((state) => ({
      bookmarks: state.bookmarks.map((b) => (b.folderId === id ? { ...b, folderId: null } : b)),
      folders: state.folders.filter((f) => {
        if (f.id === id) return false
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

  getFolderDepth: (folderId, visited: Set<string> = new Set()) => {
    if (!folderId) return 0
    if (visited.has(folderId)) return 10
    visited.add(folderId)
    const folder = get().folders.find((f) => f.id === folderId)
    if (!folder) return 0
    const depth = 1 + get().getFolderDepth(folder.parentId, visited)
    return depth > 10 ? 10 : depth
  },

  getSubfolders: (parentId) => {
    return get()
      .folders.filter((f) => f.parentId === parentId)
      .sort((a, b) => a.order - b.order)
  },

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
      bookmarks: state.bookmarks.map((b) => (b.id === id ? { ...b, ...data } : b)),
    }))
  },

  removeBookmark: (id) => {
    set((state) => ({
      bookmarks: state.bookmarks.filter((b) => b.id !== id),
    }))
  },

  moveBookmark: (bookmarkId, folderId) => {
    set((state) => ({
      bookmarks: state.bookmarks.map((b) => (b.id === bookmarkId ? { ...b, folderId } : b)),
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
    return get().bookmarks.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
  },

  resetBookmarks: () => {
    set({
      bookmarks: [],
      folders: [],
    })
  },

  reorderBookmarks: (bookmarkId, targetFolderId, newIndex) => {
    set((state) => {
      const bookmark = state.bookmarks.find((b) => b.id === bookmarkId)
      if (!bookmark) return state

      const isSameFolder = bookmark.folderId === targetFolderId

      let targetBookmarks = state.bookmarks
        .filter((b) => b.folderId === targetFolderId)
        .sort((a, b) => a.order - b.order)

      if (isSameFolder) {
        targetBookmarks = targetBookmarks.filter((b) => b.id !== bookmarkId)
      }

      targetBookmarks.splice(newIndex, 0, bookmark)

      const updatedBookmarks = targetBookmarks.map((b, idx) => ({
        ...b,
        order: idx,
        folderId: targetFolderId,
      }))

      return {
        bookmarks: state.bookmarks.map((b) => {
          const updated = updatedBookmarks.find((ub) => ub.id === b.id)
          return updated || b
        }),
      }
    })
  },

  reorderFolders: (folderId, newIndex, parentId) => {
    set((state) => {
      const folder = state.folders.find((f) => f.id === folderId)
      if (!folder) return state

      const isSameParent = folder.parentId === parentId

      let targetFolders = state.folders.filter((f) => f.parentId === parentId).sort((a, b) => a.order - b.order)

      if (isSameParent) {
        targetFolders = targetFolders.filter((f) => f.id !== folderId)
      }

      targetFolders.splice(newIndex, 0, folder)

      const updatedFolders = targetFolders.map((f, idx) => ({
        ...f,
        order: idx,
        parentId: parentId,
      }))

      return {
        folders: state.folders.map((f) => {
          const updated = updatedFolders.find((uf) => uf.id === f.id)
          return updated || f
        }),
      }
    })
  },
}))

// Load persisted data from main process (called once on app startup from App.tsx)
export async function loadBookmarksFromMain(): Promise<void> {
  try {
    const data = await window.electron.bookmarks.load()
    if (data?.bookmarks?.length > 0) {
      useBookmarksStore.setState({
        bookmarks: data.bookmarks,
        folders: data.folders ?? [],
      })
    }
  } catch (e) {
    console.error('Failed to load bookmarks:', e)
  }
}

// Persist to main process on every state change (debounced)
let saveTimer: ReturnType<typeof setTimeout> | null = null
useBookmarksStore.subscribe((state) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    window.electron.bookmarks
      .save({
        bookmarks: state.bookmarks,
        folders: state.folders,
      })
      .catch(() => {})
  }, 300)
})

// Flush pending save before app exit
window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
    const state = useBookmarksStore.getState()
    // Use navigator.sendBeacon as last resort, but for Electron IPC just fire and forget
    window.electron.bookmarks
      .save({
        bookmarks: state.bookmarks,
        folders: state.folders,
      })
      .catch(() => {})
  }
})
