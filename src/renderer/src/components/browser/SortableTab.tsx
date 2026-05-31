/**
 * Sortable tab component with drag & drop support.
 * Wraps a tab with dnd-kit's useSortable hook.
 */

import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Tab } from '@/stores/tabs'
import { X } from 'lucide-react'
import { Favicon } from '@/components/ui/Favicon'
import { useTranslation } from 'react-i18next'

interface SortableTabProps {
  tab: Tab
  isActive: boolean
  onActivate: (tabId: string) => void
  onClose: (e: React.MouseEvent, tabId: string) => void
  onContextMenu: (e: React.MouseEvent, tabId: string) => void
  onKeyDown: (e: React.KeyboardEvent, tabId: string) => void
  isVertical?: boolean
  sidebarWidth?: number
}

export const SortableTab = memo(function SortableTab({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
  onKeyDown,
  isVertical = false,
  sidebarWidth,
}: SortableTabProps) {
  const { t } = useTranslation('browser')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  }

  // Adaptive layout based on sidebar width (only in vertical mode)
  const isNarrow = isVertical && sidebarWidth !== undefined && sidebarWidth <= 80
  const isMedium = isVertical && sidebarWidth !== undefined && sidebarWidth > 80 && sidebarWidth <= 120
  const showTitle = !isNarrow && (!isMedium || isActive) // Hide title in narrow, show only on active in medium

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      className={`no-drag group flex items-center gap-2 px-2.5 py-1.5 ${isVertical ? 'rounded-lg w-full' : 'rounded-full max-w-[200px]'} cursor-pointer transition-all duration-200 border ${
        isActive
          ? 'bg-surface-active border-border-medium text-foreground'
          : 'bg-surface border-transparent text-foreground-muted hover:bg-surface-hover hover:text-foreground'
      } ${isNarrow ? 'justify-center' : ''}`}
      onClick={(_e) => {
        // Only activate if not dragging
        if (!isDragging) {
          onActivate(tab.id)
        }
      }}
      onKeyDown={(e) => onKeyDown(e, tab.id)}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
      aria-label={`Tab: ${tab.title || t('tabs.newTab')}. Press space to start dragging.`}
    >
      {/* Favicon with optional close overlay in narrow mode */}
      {isNarrow ? (
        <div className="relative w-5 h-5 flex-shrink-0">
          <Favicon
            src={tab.favicon}
            className="w-5 h-5 object-contain transition-opacity group-hover:opacity-0"
            fallbackClassName="w-5 h-5 text-foreground-muted transition-opacity group-hover:opacity-0"
          />
          {/* Close button overlay */}
          <button
            className="absolute inset-0 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-full transition-opacity flex items-center justify-center bg-surface-active"
            aria-label={`Close ${tab.title || t('tabs.closeTab')}`}
            tabIndex={0}
            onClick={(e) => onClose(e, tab.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          {/* Standard favicon */}
          <Favicon
            src={tab.favicon}
            className="w-5 h-5 flex-shrink-0 object-contain"
            fallbackClassName="w-5 h-5 flex-shrink-0 text-foreground-muted"
          />
        </>
      )}

      {/* Title - Hidden in narrow mode */}
      {showTitle && <span className="truncate text-sm flex-1">{tab.title || t('tabs.newTab')}</span>}

      {/* Close button - Standard position (only in non-narrow mode) */}
      {!isNarrow && (
        <button
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-active rounded-full p-0.5 transition-opacity"
          aria-label={`Close ${tab.title || t('tabs.closeTab')}`}
          tabIndex={0}
          onClick={(e) => onClose(e, tab.id)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
})
