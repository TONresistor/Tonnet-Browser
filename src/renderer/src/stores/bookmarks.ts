/**
 * Bookmarks store.
 * Persisted bookmark management with Zustand.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BOOKMARKS } from '@shared/constants'

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  createdAt: number
}

interface BookmarksState {
  bookmarks: Bookmark[]
  addBookmark: (url: string, title: string) => void
  updateBookmark: (id: string, data: { url?: string; title?: string }) => void
  removeBookmark: (id: string) => void
  isBookmarked: (url: string) => boolean
  resetBookmarks: () => void
}

const generateId = () => Math.random().toString(36).substring(2, 9)

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarks: [...DEFAULT_BOOKMARKS],

      addBookmark: (url, title) => {
        if (get().isBookmarked(url)) return

        const bookmark: Bookmark = {
          id: generateId(),
          url,
          title,
          createdAt: Date.now(),
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

      isBookmarked: (url) => {
        return get().bookmarks.some((b) => b.url === url)
      },

      resetBookmarks: () => {
        set({ bookmarks: [...DEFAULT_BOOKMARKS] })
      },
    }),
    {
      name: 'ton-browser-bookmarks',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<BookmarksState> | undefined
        // If no persisted bookmarks or empty array, use defaults
        if (!persisted?.bookmarks || persisted.bookmarks.length === 0) {
          return { ...currentState, bookmarks: [...DEFAULT_BOOKMARKS] }
        }
        return { ...currentState, ...persisted }
      },
    }
  )
)
