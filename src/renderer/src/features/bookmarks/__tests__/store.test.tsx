// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useBookmarksStore } from '../store'

// Mock crypto.randomUUID for deterministic IDs
let uuidCounter = 0
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
})

// Reset store and counter before each test
beforeEach(() => {
  uuidCounter = 0
  const { getState, setState } = useBookmarksStore
  // Clear persisted state and reset store
  localStorage.clear()
  setState({
    bookmarks: [],
    folders: [],
  })
  // Verify clean state
  expect(getState().bookmarks).toHaveLength(0)
  expect(getState().folders).toHaveLength(0)
})

describe('bookmarks store', () => {
  describe('addBookmark', () => {
    it('adds a bookmark to root (folderId = null)', () => {
      const { addBookmark } = useBookmarksStore.getState()
      addBookmark('http://example.ton', 'Example')

      const updated = useBookmarksStore.getState().bookmarks
      expect(updated).toHaveLength(1)
      expect(updated[0]).toMatchObject({
        url: 'http://example.ton',
        title: 'Example',
        folderId: null,
        order: 0,
      })
    })

    it('adds a bookmark to a specific folder', () => {
      const store = useBookmarksStore.getState()
      const folderId = store.addFolder('TON Sites', null)

      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example', folderId)

      const bookmark = useBookmarksStore.getState().bookmarks[0]
      expect(bookmark.folderId).toBe(folderId)
    })

    it('adds bookmark with favicon', () => {
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example', null, 'http://example.ton/favicon.ico')

      const bookmark = useBookmarksStore.getState().bookmarks[0]
      expect(bookmark.favicon).toBe('http://example.ton/favicon.ico')
    })

    it('does not add duplicate bookmarks with the same URL', () => {
      const store = useBookmarksStore.getState()
      store.addBookmark('http://example.ton', 'Example')
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Different Title')

      expect(useBookmarksStore.getState().bookmarks).toHaveLength(1)
    })

    it('assigns incrementing order values within the same folder', () => {
      const store = useBookmarksStore.getState()
      store.addBookmark('http://a.ton', 'A')
      useBookmarksStore.getState().addBookmark('http://b.ton', 'B')
      useBookmarksStore.getState().addBookmark('http://c.ton', 'C')

      const bookmarks = useBookmarksStore.getState().bookmarks
      expect(bookmarks[0].order).toBe(0)
      expect(bookmarks[1].order).toBe(1)
      expect(bookmarks[2].order).toBe(2)
    })
  })

  describe('removeBookmark', () => {
    it('removes a bookmark by id', () => {
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example')
      const bookmarkId = useBookmarksStore.getState().bookmarks[0].id

      useBookmarksStore.getState().removeBookmark(bookmarkId)

      expect(useBookmarksStore.getState().bookmarks).toHaveLength(0)
    })

    it('does not affect other bookmarks when removing one', () => {
      useBookmarksStore.getState().addBookmark('http://a.ton', 'A')
      useBookmarksStore.getState().addBookmark('http://b.ton', 'B')

      const idToRemove = useBookmarksStore.getState().bookmarks[0].id
      useBookmarksStore.getState().removeBookmark(idToRemove)

      const remaining = useBookmarksStore.getState().bookmarks
      expect(remaining).toHaveLength(1)
      expect(remaining[0].url).toBe('http://b.ton')
    })
  })

  describe('updateBookmark', () => {
    it('updates bookmark title', () => {
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Old Title')
      const id = useBookmarksStore.getState().bookmarks[0].id

      useBookmarksStore.getState().updateBookmark(id, { title: 'New Title' })

      expect(useBookmarksStore.getState().bookmarks[0].title).toBe('New Title')
    })

    it('updates bookmark URL', () => {
      useBookmarksStore.getState().addBookmark('http://old.ton', 'Site')
      const id = useBookmarksStore.getState().bookmarks[0].id

      useBookmarksStore.getState().updateBookmark(id, { url: 'http://new.ton' })

      expect(useBookmarksStore.getState().bookmarks[0].url).toBe('http://new.ton')
    })
  })

  describe('isBookmarked', () => {
    it('returns true for bookmarked URLs', () => {
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example')

      expect(useBookmarksStore.getState().isBookmarked('http://example.ton')).toBe(true)
    })

    it('returns false for non-bookmarked URLs', () => {
      expect(useBookmarksStore.getState().isBookmarked('http://not-bookmarked.ton')).toBe(false)
    })
  })

  describe('searchBookmarks', () => {
    beforeEach(() => {
      useBookmarksStore.getState().addBookmark('http://alpha.ton', 'Alpha Site')
      useBookmarksStore.getState().addBookmark('http://beta.ton', 'Beta Page')
      useBookmarksStore.getState().addBookmark('http://gamma.ton', 'Gamma Dashboard')
    })

    it('returns all bookmarks for empty query', () => {
      const results = useBookmarksStore.getState().searchBookmarks('')
      expect(results).toHaveLength(3)
    })

    it('searches by title (case-insensitive)', () => {
      const results = useBookmarksStore.getState().searchBookmarks('alpha')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Alpha Site')
    })

    it('searches by URL (case-insensitive)', () => {
      const results = useBookmarksStore.getState().searchBookmarks('beta.ton')
      expect(results).toHaveLength(1)
      expect(results[0].url).toBe('http://beta.ton')
    })

    it('returns empty array when no matches', () => {
      const results = useBookmarksStore.getState().searchBookmarks('nonexistent')
      expect(results).toHaveLength(0)
    })
  })

  describe('folder operations', () => {
    describe('addFolder', () => {
      it('creates a root-level folder', () => {
        const folderId = useBookmarksStore.getState().addFolder('My Folder', null)

        expect(folderId).toBeTruthy()
        const folders = useBookmarksStore.getState().folders
        expect(folders).toHaveLength(1)
        expect(folders[0]).toMatchObject({
          name: 'My Folder',
          parentId: null,
          order: 0,
        })
      })

      it('creates a nested folder', () => {
        const parentId = useBookmarksStore.getState().addFolder('Parent', null)
        const childId = useBookmarksStore.getState().addFolder('Child', parentId)

        expect(childId).toBeTruthy()
        const child = useBookmarksStore.getState().folders.find((f) => f.id === childId)
        expect(child?.parentId).toBe(parentId)
      })

      it('enforces max depth of 3 levels', () => {
        const level1 = useBookmarksStore.getState().addFolder('Level 1', null)
        const level2 = useBookmarksStore.getState().addFolder('Level 2', level1)
        const level3 = useBookmarksStore.getState().addFolder('Level 3', level2)

        // Level 4 should be rejected
        const level4 = useBookmarksStore.getState().addFolder('Level 4', level3)

        expect(level1).toBeTruthy()
        expect(level2).toBeTruthy()
        expect(level3).toBeTruthy()
        expect(level4).toBeNull()
        expect(useBookmarksStore.getState().folders).toHaveLength(3)
      })
    })

    describe('removeFolder', () => {
      it('removes a folder and moves its bookmarks to root', () => {
        const folderId = useBookmarksStore.getState().addFolder('Folder', null)!
        useBookmarksStore.getState().addBookmark('http://example.ton', 'Example', folderId)

        useBookmarksStore.getState().removeFolder(folderId)

        expect(useBookmarksStore.getState().folders).toHaveLength(0)
        const bookmark = useBookmarksStore.getState().bookmarks[0]
        expect(bookmark.folderId).toBeNull()
      })

      it('removes subfolders when parent is removed', () => {
        const parentId = useBookmarksStore.getState().addFolder('Parent', null)!
        useBookmarksStore.getState().addFolder('Child', parentId)

        useBookmarksStore.getState().removeFolder(parentId)

        expect(useBookmarksStore.getState().folders).toHaveLength(0)
      })
    })

    describe('getSubfolders', () => {
      it('returns only direct children of the given parent', () => {
        useBookmarksStore.getState().addFolder('Root A', null)
        useBookmarksStore.getState().addFolder('Root B', null)
        const parentId = useBookmarksStore.getState().folders[0].id
        useBookmarksStore.getState().addFolder('Child of A', parentId)

        const rootFolders = useBookmarksStore.getState().getSubfolders(null)
        expect(rootFolders).toHaveLength(2)

        const childFolders = useBookmarksStore.getState().getSubfolders(parentId)
        expect(childFolders).toHaveLength(1)
        expect(childFolders[0].name).toBe('Child of A')
      })

      it('returns folders sorted by order', () => {
        useBookmarksStore.getState().addFolder('B', null)
        useBookmarksStore.getState().addFolder('A', null)
        useBookmarksStore.getState().addFolder('C', null)

        const folders = useBookmarksStore.getState().getSubfolders(null)
        expect(folders[0].name).toBe('B')
        expect(folders[1].name).toBe('A')
        expect(folders[2].name).toBe('C')
      })
    })

    describe('getFolderDepth', () => {
      it('returns 0 for null (root level)', () => {
        expect(useBookmarksStore.getState().getFolderDepth(null)).toBe(0)
      })

      it('returns correct depth for nested folders', () => {
        const level1 = useBookmarksStore.getState().addFolder('Level 1', null)!
        const level2 = useBookmarksStore.getState().addFolder('Level 2', level1)!
        const level3 = useBookmarksStore.getState().addFolder('Level 3', level2)!

        expect(useBookmarksStore.getState().getFolderDepth(level1)).toBe(1)
        expect(useBookmarksStore.getState().getFolderDepth(level2)).toBe(2)
        expect(useBookmarksStore.getState().getFolderDepth(level3)).toBe(3)
      })

      it('returns 0 for non-existent folder id', () => {
        expect(useBookmarksStore.getState().getFolderDepth('nonexistent')).toBe(0)
      })
    })
  })

  describe('moveBookmark', () => {
    it('moves a bookmark from root to a folder', () => {
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example')
      const folderId = useBookmarksStore.getState().addFolder('Folder', null)!
      const bookmarkId = useBookmarksStore.getState().bookmarks[0].id

      useBookmarksStore.getState().moveBookmark(bookmarkId, folderId)

      expect(useBookmarksStore.getState().bookmarks[0].folderId).toBe(folderId)
    })

    it('moves a bookmark from a folder to root', () => {
      const folderId = useBookmarksStore.getState().addFolder('Folder', null)!
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example', folderId)
      const bookmarkId = useBookmarksStore.getState().bookmarks[0].id

      useBookmarksStore.getState().moveBookmark(bookmarkId, null)

      expect(useBookmarksStore.getState().bookmarks[0].folderId).toBeNull()
    })

    it('moves a bookmark between folders', () => {
      const folder1 = useBookmarksStore.getState().addFolder('Folder 1', null)!
      const folder2 = useBookmarksStore.getState().addFolder('Folder 2', null)!
      useBookmarksStore.getState().addBookmark('http://example.ton', 'Example', folder1)
      const bookmarkId = useBookmarksStore.getState().bookmarks[0].id

      useBookmarksStore.getState().moveBookmark(bookmarkId, folder2)

      expect(useBookmarksStore.getState().bookmarks[0].folderId).toBe(folder2)
    })
  })

  describe('getBookmarksByFolder', () => {
    it('returns only bookmarks in the specified folder', () => {
      const folderId = useBookmarksStore.getState().addFolder('Folder', null)!
      useBookmarksStore.getState().addBookmark('http://a.ton', 'A', null)
      useBookmarksStore.getState().addBookmark('http://b.ton', 'B', folderId)
      useBookmarksStore.getState().addBookmark('http://c.ton', 'C', folderId)

      const rootBookmarks = useBookmarksStore.getState().getBookmarksByFolder(null)
      expect(rootBookmarks).toHaveLength(1)
      expect(rootBookmarks[0].url).toBe('http://a.ton')

      const folderBookmarks = useBookmarksStore.getState().getBookmarksByFolder(folderId)
      expect(folderBookmarks).toHaveLength(2)
    })

    it('returns bookmarks sorted by order', () => {
      useBookmarksStore.getState().addBookmark('http://first.ton', 'First')
      useBookmarksStore.getState().addBookmark('http://second.ton', 'Second')

      const bookmarks = useBookmarksStore.getState().getBookmarksByFolder(null)
      expect(bookmarks[0].order).toBeLessThan(bookmarks[1].order)
    })
  })

  describe('resetBookmarks', () => {
    it('clears all bookmarks and folders', () => {
      useBookmarksStore.getState().addFolder('Custom Folder', null)
      useBookmarksStore.getState().addBookmark('http://custom.ton', 'Custom')

      useBookmarksStore.getState().resetBookmarks()

      const state = useBookmarksStore.getState()
      expect(state.folders).toHaveLength(0)
      expect(state.bookmarks).toHaveLength(0)
    })
  })

  describe('reorderBookmarks', () => {
    it('reorders bookmarks within the same folder', () => {
      useBookmarksStore.getState().addBookmark('http://a.ton', 'A')
      useBookmarksStore.getState().addBookmark('http://b.ton', 'B')
      useBookmarksStore.getState().addBookmark('http://c.ton', 'C')

      const bookmarkA = useBookmarksStore.getState().bookmarks.find((b) => b.url === 'http://a.ton')!
      // Move A to position 2 (after B and C)
      useBookmarksStore.getState().reorderBookmarks(bookmarkA.id, null, 2)

      const reordered = useBookmarksStore.getState().getBookmarksByFolder(null)
      expect(reordered[0].url).toBe('http://b.ton')
      expect(reordered[1].url).toBe('http://c.ton')
      expect(reordered[2].url).toBe('http://a.ton')
    })

    it('moves a bookmark to a different folder during reorder', () => {
      const folderId = useBookmarksStore.getState().addFolder('Target', null)!
      useBookmarksStore.getState().addBookmark('http://a.ton', 'A')

      const bookmarkA = useBookmarksStore.getState().bookmarks[0]
      useBookmarksStore.getState().reorderBookmarks(bookmarkA.id, folderId, 0)

      const movedBookmark = useBookmarksStore.getState().bookmarks.find((b) => b.id === bookmarkA.id)!
      expect(movedBookmark.folderId).toBe(folderId)
    })
  })
})
