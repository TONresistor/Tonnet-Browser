/**
 * Sortable tab component with drag & drop support.
 * Wraps a tab with dnd-kit's useSortable hook.
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Tab } from '@/stores/tabs'
import { X, Globe } from 'lucide-react'

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  onActivate: () => void
  onClose: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export function SortableTab({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
  onKeyDown,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      className={`no-drag group flex items-center gap-2 px-2.5 py-1.5 rounded-full cursor-pointer transition-all duration-200 max-w-[200px] border ${
        isActive
          ? 'bg-surface-active border-border-medium text-foreground'
          : 'bg-surface border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground'
      }`}
      onClick={(e) => {
        // Only activate if not dragging
        if (!isDragging) {
          onActivate()
        }
      }}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      aria-label={`Tab: ${tab.title || 'New Tab'}. Press space to start dragging.`}
    >
      {/* Favicon */}
      {tab.favicon ? (
        <img
          src={tab.favicon}
          alt=""
          className="w-5 h-5 flex-shrink-0 object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <Globe className="w-5 h-5 flex-shrink-0 text-foreground-muted" />
      )}

      <span className="truncate text-sm flex-1">{tab.title || 'New Tab'}</span>

      <button
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-active rounded-full p-0.5 transition-opacity"
        aria-label={`Close ${tab.title || 'tab'}`}
        tabIndex={0}
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
