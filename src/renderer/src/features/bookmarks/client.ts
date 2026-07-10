export const bookmarksClient = {
  load: () => window.electron.bookmarks.load(),
  save: (...args: Parameters<typeof window.electron.bookmarks.save>) => window.electron.bookmarks.save(...args),
}
