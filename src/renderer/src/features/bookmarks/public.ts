import { useBookmarksStore } from './store'

export const useBookmarksCount = () => useBookmarksStore((state) => state.bookmarks.length)
