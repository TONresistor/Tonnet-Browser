/**
 * Bookmarks toolbar.
 * Displays and manages saved bookmarks with folder support.
 */

import { useState, useEffect, useRef } from 'react'
import { useBookmarksStore, Bookmark } from '@/stores/bookmarks'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { ErrorBoundary } from '../ErrorBoundary'
import { ChevronDown } from 'lucide-react'

interface EditModal {
  bookmark: Bookmark
  name: string
  url: string
}

interface RenameModal {
  folderId: string
  name: string
}

export function BookmarksBar() {
  const { bookmarks, folders, getBookmarksByFolder, getSubfolders, updateBookmark, removeBookmark, updateFolder, removeFolder } = useBookmarksStore()
  const { proxyConnected } = useSettingsStore()
  const { navigateActiveTab, addTab } = useTabsStore()
  const [editModal, setEditModal] = useState<EditModal | null>(null)
  const [renameModal, setRenameModal] = useState<RenameModal | null>(null)

  // Use refs to avoid re-registering listeners
  const addTabRef = useRef(addTab)
  const removeBookmarkRef = useRef(removeBookmark)
  const removeFolderRef = useRef(removeFolder)
  const getBookmarksByFolderRef = useRef(getBookmarksByFolder)

  // Keep refs updated
  useEffect(() => {
    addTabRef.current = addTab
    removeBookmarkRef.current = removeBookmark
    removeFolderRef.current = removeFolder
    getBookmarksByFolderRef.current = getBookmarksByFolder
  }, [addTab, removeBookmark, removeFolder, getBookmarksByFolder])

  // Hide/show BrowserView when modals open/close
  useEffect(() => {
    if (editModal || renameModal) {
      window.electron.view.hide()
    } else {
      window.electron.view.show()
    }
  }, [editModal, renameModal])

  // Listen for IPC events from main process - only once
  useEffect(() => {
    const unsubOpenNewTab = window.electron.on('bookmark:open-new-tab', (...args: unknown[]) => {
      const url = args[0] as string
      addTabRef.current(url)
    })

    const unsubEdit = window.electron.on('bookmark:edit', (...args: unknown[]) => {
      const data = args[0]
      // Runtime validation
      if (!data || typeof data !== 'object') {
        console.error('[BookmarksBar] Invalid bookmark:edit data:', data)
        return
      }
      const bookmark = data as { id: string; title: string; url: string }
      if (!bookmark.id || !bookmark.title || !bookmark.url) {
        console.error('[BookmarksBar] Missing required fields in bookmark:edit')
        return
      }
      setEditModal({
        bookmark: { id: bookmark.id, title: bookmark.title, url: bookmark.url, createdAt: Date.now() },
        name: bookmark.title,
        url: bookmark.url
      })
    })

    const unsubDelete = window.electron.on('bookmark:delete', (...args: unknown[]) => {
      const id = args[0] as string
      removeBookmarkRef.current(id)
    })

    const unsubFolderRename = window.electron.on('folder:rename', (...args: unknown[]) => {
      const { folderId, folderName } = args[0] as { folderId: string; folderName: string }
      setRenameModal({ folderId, name: folderName })
    })

    const unsubFolderDelete = window.electron.on('folder:delete', (...args: unknown[]) => {
      const folderId = args[0] as string
      if (confirm('Delete this folder? Bookmarks will be moved to unfiled.')) {
        removeFolderRef.current(folderId)
      }
    })

    const unsubFolderOpenAll = window.electron.on('folder:open-all', (...args: unknown[]) => {
      const folderId = args[0] as string
      const bookmarks = getBookmarksByFolderRef.current(folderId)
      bookmarks.forEach(b => addTabRef.current(b.url))
    })

    return () => {
      unsubOpenNewTab()
      unsubEdit()
      unsubDelete()
      unsubFolderRename()
      unsubFolderDelete()
      unsubFolderOpenAll()
    }
  }, []) // Empty deps - all callbacks use refs or state setters

  if (!proxyConnected || (bookmarks.length === 0 && folders.length === 0)) return null

  // Get top-level items (bookmarks without folder + top-level folders)
  const topLevelBookmarks = getBookmarksByFolder(null)
  const topLevelFolders = getSubfolders(null)

  const handleContextMenu = (e: React.MouseEvent, bookmark: Bookmark) => {
    e.preventDefault()
    window.electron.showBookmarkMenu(bookmark.id, bookmark.title, bookmark.url)
  }

  const handleFolderClick = (folderId: string) => {
    const folderBookmarks = getBookmarksByFolder(folderId)
    // Convert to simple objects for IPC
    const bookmarksData = folderBookmarks.map(b => ({
      id: b.id,
      title: b.title,
      url: b.url
    }))
    window.electron.showFolderMenu(folderId, bookmarksData)
  }

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string, folderName: string) => {
    e.preventDefault()
    e.stopPropagation() // Prevent normal click dropdown
    window.electron.showFolderContextMenu(folderId, folderName)
  }

  const closeEditModal = () => {
    setEditModal(null)
  }

  const handleSaveEdit = () => {
    if (editModal) {
      updateBookmark(editModal.bookmark.id, {
        title: editModal.name.trim() || editModal.bookmark.title,
        url: editModal.url.trim() || editModal.bookmark.url,
      })
      closeEditModal()
    }
  }

  return (
    <ErrorBoundary>
      <div className="flex items-center gap-1.5 px-2 py-1 overflow-x-auto">
        {/* Top-level bookmarks (no folder) */}
        {topLevelBookmarks.map((bookmark) => (
          <button
            key={bookmark.id}
            className="px-3 py-1.5 rounded-full text-sm transition-all duration-200 shrink-0 bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground"
            onClick={() => navigateActiveTab(bookmark.url)}
            onContextMenu={(e) => handleContextMenu(e, bookmark)}
          >
            {bookmark.title}
          </button>
        ))}

        {/* Top-level folders with native menu */}
        {topLevelFolders.map((folder) => (
          <button
            key={folder.id}
            className="px-3 py-1.5 rounded-full text-sm transition-all duration-200 shrink-0 bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground flex items-center gap-1"
            onClick={() => handleFolderClick(folder.id)}
            onContextMenu={(e) => handleFolderContextMenu(e, folder.id, folder.name)}
          >
            {folder.name}
            <ChevronDown className="w-3 h-3" />
          </button>
        ))}
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={closeEditModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-bookmark-title"
        >
          <div
            className="rounded-2xl p-5 w-full max-w-sm mx-4 bg-background/85 backdrop-blur-xl border border-border-medium shadow-2xl font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="edit-bookmark-title" className="text-foreground font-bold mb-4">Edit bookmark</h3>
            <div className="space-y-3">
              <div>
                <label className="text-muted-foreground text-xs block mb-1">Name</label>
                <input
                  value={editModal.name}
                  onChange={(e) => setEditModal({ ...editModal, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-muted-foreground text-xs block mb-1">URL</label>
                <input
                  value={editModal.url}
                  onChange={(e) => setEditModal({ ...editModal, url: e.target.value })}
                  className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
                onClick={closeEditModal}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] bg-primary/90 text-foreground shadow-primary/40 shadow-lg"
                onClick={handleSaveEdit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setRenameModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-folder-title"
        >
          <div
            className="rounded-2xl p-5 w-full max-w-sm mx-4 bg-background/85 backdrop-blur-xl border border-border-medium shadow-2xl font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rename-folder-title" className="text-foreground font-bold mb-4">Rename folder</h3>
            <input
              value={renameModal.name}
              onChange={(e) => setRenameModal({ ...renameModal, name: e.target.value })}
              className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (renameModal.name.trim()) {
                    updateFolder(renameModal.folderId, { name: renameModal.name.trim() })
                  }
                  setRenameModal(null)
                } else if (e.key === 'Escape') {
                  setRenameModal(null)
                }
              }}
            />
            <div className="flex gap-3 mt-5">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
                onClick={() => setRenameModal(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] bg-primary/90 text-foreground shadow-primary/40 shadow-lg"
                onClick={() => {
                  if (renameModal.name.trim()) {
                    updateFolder(renameModal.folderId, { name: renameModal.name.trim() })
                  }
                  setRenameModal(null)
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  )
}
