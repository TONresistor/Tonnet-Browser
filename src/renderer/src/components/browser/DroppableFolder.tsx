/**
 * Droppable folder component for bookmark bar.
 * Provides visual feedback when bookmarks are dragged over it.
 */

import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { BookmarkFolder } from '@/stores/bookmarks'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface DroppableFolderProps {
  folder: BookmarkFolder
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

export function DroppableFolder({ folder, onClick, onContextMenu }: DroppableFolderProps) {
  const { t } = useTranslation('browser')
  // Make folder sortable (can be reordered)
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: folder.id,
    data: { type: 'folder', folderId: folder.id },
  })

  // Also make it droppable (can receive bookmarks)
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `droppable-${folder.id}`,
    data: { type: 'folder', folderId: folder.id },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  // Combine refs
  const setRefs = (node: HTMLElement | null) => {
    setSortableRef(node)
    setDroppableRef(node)
  }

  return (
    <button
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        px-3 py-1.5 rounded-full text-sm transition-all duration-200 shrink-0
        flex items-center gap-1
        ${
          isOver
            ? 'bg-primary/20 text-foreground ring-2 ring-primary scale-105'
            : 'bg-surface text-foreground-muted hover:bg-surface-active hover:text-foreground'
        }
      `}
      onClick={(e) => {
        // Only open dropdown if not dragging
        if (!isDragging) {
          onClick(e)
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(e)
      }}
      aria-label={t('dnd.folderAriaLabel', { name: folder.name })}
    >
      {folder.name}
      <ChevronDown className="w-3 h-3" />
    </button>
  )
}
