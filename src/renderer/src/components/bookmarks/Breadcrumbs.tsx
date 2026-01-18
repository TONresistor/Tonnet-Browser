/**
 * Breadcrumbs navigation for bookmark folders
 * Shows current folder path and allows navigation
 */

import { ChevronRight } from 'lucide-react'
import { useBookmarksStore } from '@/stores/bookmarks'

interface BreadcrumbsProps {
  currentFolderId: string | null
  onNavigate: (folderId: string | null) => void
}

export function Breadcrumbs({ currentFolderId, onNavigate }: BreadcrumbsProps) {
  const { folders } = useBookmarksStore()

  // Build breadcrumb path
  const buildPath = (): { id: string | null; name: string }[] => {
    const path: { id: string | null; name: string }[] = [{ id: null, name: 'All Bookmarks' }]

    if (!currentFolderId) return path

    const findPath = (folderId: string): { id: string; name: string }[] => {
      const folder = folders.find((f) => f.id === folderId)
      if (!folder) return []

      const parentPath = folder.parentId ? findPath(folder.parentId) : []
      return [...parentPath, { id: folder.id, name: folder.name }]
    }

    return [...path, ...findPath(currentFolderId)]
  }

  const path = buildPath()

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
      {path.map((item, index) => (
        <div key={item.id ?? 'root'} className="flex items-center gap-2">
          {index > 0 && <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
          <button
            onClick={() => onNavigate(item.id)}
            className={
              index === path.length - 1
                ? 'font-medium text-foreground cursor-default'
                : 'text-primary hover:text-primary/80 transition-colors'
            }
          >
            {item.name}
          </button>
        </div>
      ))}
    </div>
  )
}
