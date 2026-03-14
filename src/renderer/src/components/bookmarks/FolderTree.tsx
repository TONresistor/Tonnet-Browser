/**
 * FolderTree component for bookmark folder navigation
 * Supports hierarchical folder structure with expand/collapse
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Edit2, Trash2 } from 'lucide-react'
import { useBookmarksStore, BookmarkFolder } from '@/stores/bookmarks'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface FolderTreeProps {
  selectedFolderId: string | null
  onSelectFolder: (folderId: string | null) => void
  onEditFolder: (folder: BookmarkFolder) => void
}

export function FolderTree({ selectedFolderId, onSelectFolder, onEditFolder }: FolderTreeProps) {
  const { t } = useTranslation('settings')
  const { getBookmarksByFolder, getSubfolders, removeFolder } = useBookmarksStore()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']))
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    }
  }, [])

  const toggleExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const handleDeleteFolder = (e: React.MouseEvent, folder: BookmarkFolder) => {
    e.stopPropagation()
    if (pendingDeleteId === folder.id) {
      removeFolder(folder.id)
      setPendingDeleteId(null)
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      if (selectedFolderId === folder.id) {
        onSelectFolder(null)
      }
    } else {
      setPendingDeleteId(folder.id)
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = setTimeout(() => setPendingDeleteId(null), 3000)
    }
  }

  const renderFolder = (folder: BookmarkFolder | null, level: number = 0) => {
    const folderId = folder?.id ?? null
    const isRoot = folderId === null
    const isExpanded = expandedFolders.has(folderId ?? 'root')
    const isSelected = selectedFolderId === folderId
    const subfolders = getSubfolders(folderId)
    const hasSubfolders = subfolders.length > 0
    const bookmarksCount = isRoot ? getBookmarksByFolder(null).length : getBookmarksByFolder(folderId).length

    return (
      <div key={folderId ?? 'root'}>
        <button
          onClick={() => {
            if (hasSubfolders && !isRoot) {
              toggleExpand(folderId!)
            }
            onSelectFolder(folderId)
          }}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors rounded-lg group',
            isSelected
              ? 'bg-surface-active text-foreground'
              : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
          )}
          style={{ paddingLeft: `${12 + level * 16}px` }}
        >
          {/* Expand/collapse icon */}
          {hasSubfolders && !isRoot && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(folderId!)
              }}
              className="p-0.5 hover:bg-surface-active rounded transition-colors"
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Folder icon */}
          {isRoot ? (
            <Folder className="w-4 h-4 flex-shrink-0" />
          ) : isExpanded ? (
            <FolderOpen className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0" />
          )}

          {/* Folder name */}
          <span className="flex-1 text-left truncate">{isRoot ? 'Unfiled Bookmarks' : folder!.name}</span>

          {/* Count badge */}
          {bookmarksCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface/50">{bookmarksCount}</span>
          )}

          {/* Actions - only for non-root folders */}
          {!isRoot && folder && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onEditFolder(folder)
                }}
                className="p-1 hover:bg-surface-active rounded transition-colors"
                title="Rename folder"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => handleDeleteFolder(e, folder)}
                className={`p-1 rounded transition-colors ${
                  pendingDeleteId === folder.id ? 'bg-destructive/20' : 'hover:bg-destructive/10'
                }`}
                title="Delete folder"
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          )}
        </button>

        {/* Render subfolders */}
        {isExpanded && subfolders.map((subfolder) => renderFolder(subfolder, level + 1))}
      </div>
    )
  }

  // Get total bookmark count for "All Bookmarks"
  const totalBookmarks = useBookmarksStore((state) => state.bookmarks.length)
  const topLevelFolders = getSubfolders(null)

  return (
    <div className="space-y-1">
      {/* All Bookmarks - shows everything */}
      <button
        onClick={() => onSelectFolder(null)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors rounded-lg',
          selectedFolderId === null
            ? 'bg-surface-active text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
        )}
      >
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left">{t('bookmarks.allBookmarks')}</span>
        {totalBookmarks > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface/50">{totalBookmarks}</span>
        )}
      </button>

      {/* User-created folders */}
      {topLevelFolders.map((folder) => renderFolder(folder, 0))}
    </div>
  )
}
