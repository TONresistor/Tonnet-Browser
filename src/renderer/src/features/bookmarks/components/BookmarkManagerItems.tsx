import type { MouseEvent, ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  GripVertical,
  Pen,
  SquarePen,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Favicon } from '@/components/ui/Favicon'
import { cn } from '@/lib/utils'
import type { Bookmark, BookmarkFolder } from '../store'

interface SortableBookmarkRowProps {
  bookmark: Bookmark
  isPendingDelete: boolean
  onNavigate: (url: string) => void
  onOpenNewTab: (url: string) => void
  onEdit: (bookmark: Bookmark) => void
  onDelete: (id: string) => void
}

export function SortableBookmarkRow({
  bookmark,
  isPendingDelete,
  onNavigate,
  onOpenNewTab,
  onEdit,
  onDelete,
}: SortableBookmarkRowProps) {
  const { t } = useTranslation('settings')
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bookmark.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={cn(
        'group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover',
        isDragging && 'z-10 shadow-lg'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <Favicon
        src={bookmark.favicon}
        className="h-4 w-4 flex-shrink-0 object-contain"
        fallbackClassName="h-4 w-4 flex-shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => onNavigate(bookmark.url)}
          className="block truncate text-left text-[14px] font-medium text-foreground transition-colors hover:text-primary"
        >
          {bookmark.title}
        </button>
        <div className="truncate text-xs text-muted-foreground">{bookmark.url}</div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          onClick={() => onOpenNewTab(bookmark.url)}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          title={t('bookmarks.openInNewTab')}
        >
          <ExternalLink className="h-4 w-4 text-foreground" />
        </button>
        <button
          onClick={() => onEdit(bookmark)}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          title={t('bookmarks.edit')}
        >
          <SquarePen className="h-4 w-4 text-foreground" />
        </button>
        <button
          onClick={() => onDelete(bookmark.id)}
          className={cn(
            'rounded-full p-2 transition-colors',
            isPendingDelete
              ? 'bg-destructive/15 text-destructive'
              : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
          )}
          title={t('bookmarks.delete')}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

interface DroppableFolderItemProps {
  folder: BookmarkFolder | null
  isRoot: boolean
  level: number
  isSelected: boolean
  isExpanded: boolean
  hasSubfolders: boolean
  bookmarksCount: number
  isPendingDelete: boolean
  onSelect: () => void
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: (event: MouseEvent) => void
  children?: ReactNode
}

export function DroppableFolderItem({
  folder,
  isRoot,
  level,
  isSelected,
  isExpanded,
  hasSubfolders,
  bookmarksCount,
  isPendingDelete,
  onSelect,
  onToggleExpand,
  onEdit,
  onDelete,
  children,
}: DroppableFolderItemProps) {
  const { t } = useTranslation('settings')
  const folderId = folder?.id ?? 'root-unfiled'
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${folderId}`,
    data: { type: 'folder', folderId: folder?.id ?? null },
  })

  return (
    <div>
      <button
        ref={setNodeRef}
        onClick={() => {
          if (hasSubfolders && !isRoot) onToggleExpand()
          onSelect()
        }}
        className={cn(
          'group flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm transition-colors',
          isOver && 'bg-primary/10 ring-2 ring-primary',
          isSelected
            ? 'bg-[hsl(var(--primary)/0.14)] text-foreground'
            : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
        )}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        {hasSubfolders && !isRoot && (
          <span
            onClick={(event) => {
              event.stopPropagation()
              onToggleExpand()
            }}
            className="rounded-full p-0.5 transition-colors hover:bg-surface"
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        )}
        {isRoot ? (
          <Folder className="h-4 w-4 flex-shrink-0" />
        ) : isExpanded ? (
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
        ) : (
          <Folder className="h-4 w-4 flex-shrink-0" />
        )}
        <span className="flex-1 truncate text-left">{isRoot ? t('bookmarks.allBookmarks') : folder!.name}</span>
        {bookmarksCount > 0 && (
          <span className="rounded-full bg-elevation-3 px-1.5 py-0.5 text-xs text-muted-foreground">
            {bookmarksCount}
          </span>
        )}
        {!isRoot && folder && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <span
              onClick={(event) => {
                event.stopPropagation()
                onEdit()
              }}
              className="cursor-pointer rounded-full p-1 transition-colors hover:bg-surface"
              title={t('bookmarks.renameFolder')}
            >
              <Pen className="h-3.5 w-3.5" />
            </span>
            <span
              onClick={(event) => {
                event.stopPropagation()
                onDelete(event)
              }}
              className={cn(
                'cursor-pointer rounded-full p-1 transition-colors',
                isPendingDelete ? 'bg-destructive/20' : 'hover:bg-destructive/10'
              )}
              title={t('bookmarks.deleteFolder')}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </span>
          </div>
        )}
      </button>
      {isExpanded && children}
    </div>
  )
}
