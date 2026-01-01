/**
 * Bookmarks toolbar.
 * Displays and manages saved bookmarks.
 */

import { useState, useEffect, useRef } from 'react'
import { useBookmarksStore, Bookmark } from '@/stores/bookmarks'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'

interface EditModal {
  bookmark: Bookmark
  name: string
  url: string
}

export function BookmarksBar() {
  const { bookmarks, updateBookmark, removeBookmark } = useBookmarksStore()
  const { proxyConnected } = useSettingsStore()
  const { navigateActiveTab, addTab } = useTabsStore()
  const [editModal, setEditModal] = useState<EditModal | null>(null)

  // Use refs to avoid re-registering listeners
  const addTabRef = useRef(addTab)
  const removeBookmarkRef = useRef(removeBookmark)

  // Keep refs updated
  useEffect(() => {
    addTabRef.current = addTab
    removeBookmarkRef.current = removeBookmark
  }, [addTab, removeBookmark])

  // Hide/show BrowserView when edit modal opens/closes
  useEffect(() => {
    if (editModal) {
      window.electron.view.hide()
    } else {
      window.electron.view.show()
    }
  }, [editModal])

  // Listen for context menu actions from main process - only once
  useEffect(() => {
    const unsubOpenNewTab = window.electron.on('bookmark:open-new-tab', (...args: unknown[]) => {
      const url = args[0] as string
      addTabRef.current(url)
    })

    const unsubEdit = window.electron.on('bookmark:edit', (...args: unknown[]) => {
      const data = args[0] as { id: string; title: string; url: string }
      setEditModal({
        bookmark: { id: data.id, title: data.title, url: data.url, createdAt: Date.now() },
        name: data.title,
        url: data.url
      })
    })

    const unsubDelete = window.electron.on('bookmark:delete', (...args: unknown[]) => {
      const id = args[0] as string
      removeBookmarkRef.current(id)
    })

    return () => {
      unsubOpenNewTab()
      unsubEdit()
      unsubDelete()
    }
  }, []) // Empty deps - only register once

  if (!proxyConnected || bookmarks.length === 0) return null

  const handleContextMenu = (e: React.MouseEvent, bookmark: Bookmark) => {
    e.preventDefault()
    window.electron.showBookmarkMenu(bookmark.id, bookmark.title, bookmark.url)
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
    <>
      <div className="flex items-center gap-1.5 px-2 py-1 overflow-x-auto">
        {bookmarks.map((bookmark) => (
          <button
            key={bookmark.id}
            className="px-3 py-1.5 rounded-full text-sm transition-all duration-200 shrink-0 bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground"
            onClick={() => navigateActiveTab(bookmark.url)}
            onContextMenu={(e) => handleContextMenu(e, bookmark)}
          >
            {bookmark.title}
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
    </>
  )
}
