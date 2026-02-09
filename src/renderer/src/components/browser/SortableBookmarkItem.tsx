/**
 * Sortable bookmark item component with drag & drop support.
 * Wraps a bookmark with dnd-kit's useSortable hook.
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bookmark } from '@/stores/bookmarks'
import { Globe } from 'lucide-react'

interface SortableBookmarkItemProps {
  bookmark: Bookmark
  onNavigate: (url: string) => void
  onContextMenu: (e: React.MouseEvent, bookmark: Bookmark) => void
}

export function SortableBookmarkItem({ bookmark, onNavigate, onContextMenu }: SortableBookmarkItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bookmark.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="px-2.5 py-1.5 rounded-full text-sm transition-all duration-200 shrink-0 bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground flex items-center gap-2"
      onClick={(_e) => {
        // Only navigate if not dragging
        if (!isDragging) {
          onNavigate(bookmark.url)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, bookmark)
      }}
      aria-label={`Bookmark: ${bookmark.title}. Press space to start dragging.`}
    >
      {bookmark.favicon ? (
        <img
          src={bookmark.favicon}
          alt=""
          className="w-4 h-4 flex-shrink-0 object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <Globe className="w-4 h-4 flex-shrink-0" />
      )}
      <span>{bookmark.title}</span>
    </button>
  )
}
