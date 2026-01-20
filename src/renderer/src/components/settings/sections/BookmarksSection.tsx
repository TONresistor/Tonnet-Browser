/**
 * Section Bookmarks
 */

import { memo, useState, useMemo } from 'react'
import {
  ExternalLink,
  RotateCcw,
  Search,
  Plus,
  Edit,
  Trash2,
  Bookmark,
} from 'lucide-react'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { FolderTree } from '@/components/bookmarks/FolderTree'
import { Breadcrumbs } from '@/components/bookmarks/Breadcrumbs'
import { useBookmarksStore } from '@/stores/bookmarks'
import { useTabsStore } from '@/stores/tabs'

interface BookmarksSectionProps {
  bookmarksCount: number
  onExport: () => void
  onReset: () => void
}

export const BookmarksSection = memo(function BookmarksSection({
  bookmarksCount,
  onExport,
  onReset,
}: BookmarksSectionProps) {
  const {
    bookmarks,
    folders,
    searchBookmarks,
    removeBookmark,
    updateBookmark,
    getBookmarksByFolder,
    addFolder,
    updateFolder,
    getFolderDepth,
  } = useBookmarksStore()
  const { navigateActiveTab, addTab } = useTabsStore()
  const [query, setQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [editingBookmark, setEditingBookmark] = useState<{
    id: string
    title: string
    url: string
    folderId: string | null
  } | null>(null)
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null)
  const [creatingFolder, setCreatingFolder] = useState<{
    parentId: string | null
    name: string
  } | null>(null)

  const displayBookmarks = useMemo(() => {
    return query
      ? searchBookmarks(query)
      : selectedFolderId === null
        ? bookmarks
        : getBookmarksByFolder(selectedFolderId)
  }, [query, selectedFolderId, bookmarks, searchBookmarks, getBookmarksByFolder])

  const handleEdit = (bookmark: (typeof bookmarks)[0]) => {
    setEditingBookmark({
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      folderId: bookmark.folderId,
    })
  }

  const handleSaveEdit = () => {
    if (editingBookmark) {
      updateBookmark(editingBookmark.id, {
        title: editingBookmark.title,
        url: editingBookmark.url,
        folderId: editingBookmark.folderId,
      })
      setEditingBookmark(null)
    }
  }

  const handleDelete = (id: string, title: string) => {
    if (confirm(`Delete "${title}"?`)) {
      removeBookmark(id)
    }
  }

  const handleNewFolder = (parentId: string | null) => {
    const depth = getFolderDepth(parentId)
    if (depth >= 3) {
      alert('Maximum folder depth (3 levels) reached.')
      return
    }
    setCreatingFolder({ parentId, name: '' })
  }

  const handleSaveNewFolder = () => {
    if (creatingFolder && creatingFolder.name.trim()) {
      addFolder(creatingFolder.name.trim(), creatingFolder.parentId)
      setCreatingFolder(null)
    }
  }

  const handleEditFolder = (folder: (typeof folders)[0]) => {
    setEditingFolder({ id: folder.id, name: folder.name })
  }

  const handleSaveFolderEdit = () => {
    if (editingFolder && editingFolder.name.trim()) {
      updateFolder(editingFolder.id, { name: editingFolder.name.trim() })
      setEditingFolder(null)
    }
  }

  return (
    <div>
      <SectionHeader title="Bookmarks" description="Manage your saved sites with folders" />

      {/* Settings Row */}
      <div className="bg-card rounded-xl border border-border px-4 mb-6">
        <SettingRow label="Saved bookmarks" description="Number of bookmarks in your library">
          <span className="text-foreground font-medium">{bookmarksCount}</span>
        </SettingRow>
        <SettingRow label="Export bookmarks" description="Download bookmarks as JSON file">
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
          >
            <ExternalLink className="h-4 w-4" />
            Export
          </button>
        </SettingRow>
        <SettingRow label="Reset bookmarks" description="Restore default bookmarks and folders">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200 bg-neutral-500/15 border border-neutral-500/30 text-neutral-400 hover:text-neutral-300"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </SettingRow>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search bookmarks..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-full focus:ring-2 focus:ring-primary focus:border-transparent bg-background text-foreground"
          />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-4">
        {/* Left sidebar: Folder tree */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-card rounded-2xl border border-border p-3">
            <div className="flex items-center justify-between mb-3 px-2">
              <h4 className="text-sm font-semibold text-foreground">Folders</h4>
              <button
                onClick={() => handleNewFolder(selectedFolderId)}
                className="w-6 h-6 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                title="New Folder"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <FolderTree
              selectedFolderId={selectedFolderId}
              onSelectFolder={setSelectedFolderId}
              onEditFolder={handleEditFolder}
            />
          </div>
        </div>

        {/* Right panel: Bookmarks list */}
        <div className="flex-1 min-w-0">
          <Breadcrumbs currentFolderId={selectedFolderId} onNavigate={setSelectedFolderId} />

          {displayBookmarks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {query ? 'No bookmarks match your search' : 'No bookmarks in this folder'}
            </div>
          ) : (
            <div className="bg-card rounded-2xl border border-border divide-y divide-border overflow-hidden">
              {displayBookmarks.map((bookmark, index) => (
                <div
                  key={bookmark.id}
                  className={`p-4 hover:bg-surface-hover transition-colors group ${
                    index === 0 ? 'rounded-t-2xl' : ''
                  } ${index === displayBookmarks.length - 1 ? 'rounded-b-2xl' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {bookmark.favicon ? (
                      <img src={bookmark.favicon} alt="" className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <Bookmark className="w-4 h-4 text-primary flex-shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => navigateActiveTab(bookmark.url)}
                          className="font-medium text-primary hover:text-primary/80 truncate text-left"
                        >
                          {bookmark.title}
                        </button>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{bookmark.url}</div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => addTab(bookmark.url)}
                        className="p-2 hover:bg-surface-active rounded transition-colors"
                        title="Open in new tab"
                      >
                        <ExternalLink className="w-4 h-4 text-foreground" />
                      </button>
                      <button
                        onClick={() => handleEdit(bookmark)}
                        className="p-2 hover:bg-surface-active rounded transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4 text-foreground" />
                      </button>
                      <button
                        onClick={() => handleDelete(bookmark.id, bookmark.title)}
                        className="p-2 hover:bg-destructive/10 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Bookmark Modal */}
      {editingBookmark && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setEditingBookmark(null)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">Edit Bookmark</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">Title</label>
                <input
                  value={editingBookmark.title}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, title: e.target.value })}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">URL</label>
                <input
                  value={editingBookmark.url}
                  onChange={(e) => setEditingBookmark({ ...editingBookmark, url: e.target.value })}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">Folder</label>
                <select
                  value={editingBookmark.folderId ?? ''}
                  onChange={(e) =>
                    setEditingBookmark({ ...editingBookmark, folderId: e.target.value || null })
                  }
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="">Unfiled Bookmarks</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setEditingBookmark(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleSaveEdit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {creatingFolder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setCreatingFolder(null)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">New Folder</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">Name</label>
                <input
                  value={creatingFolder.name}
                  onChange={(e) => setCreatingFolder({ ...creatingFolder, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveNewFolder()
                    }
                  }}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                  placeholder="Enter folder name..."
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setCreatingFolder(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveNewFolder}
                disabled={!creatingFolder.name.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Folder Modal */}
      {editingFolder && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
          onClick={() => setEditingFolder(null)}
        >
          <div
            className="rounded-2xl p-6 w-full max-w-md mx-4 bg-background border border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-4">Rename Folder</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">Name</label>
                <input
                  value={editingFolder.name}
                  onChange={(e) => setEditingFolder({ ...editingFolder, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveFolderEdit()
                    }
                  }}
                  className="w-full px-4 py-2 rounded-full border border-border bg-background text-foreground focus:ring-2 focus:ring-primary focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium border border-border hover:bg-surface-hover transition-colors"
                onClick={() => setEditingFolder(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-2.5 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={handleSaveFolderEdit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
