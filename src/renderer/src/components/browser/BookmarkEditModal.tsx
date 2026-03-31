import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { Bookmark } from '@/stores/bookmarks'

interface EditModalState {
  bookmark: Bookmark
  name: string
  url: string
}

interface BookmarkEditModalProps {
  editModal: EditModalState
  onChangeModal: (modal: EditModalState) => void
  onSave: () => void
  onClose: () => void
}

export function BookmarkEditModal({ editModal, onChangeModal, onSave, onClose }: BookmarkEditModalProps) {
  const { t } = useTranslation('settings')
  const editModalRef = useRef<HTMLDivElement>(null)

  useFocusTrap(editModalRef, true)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-bookmark-title"
    >
      <div
        ref={editModalRef}
        className="rounded-[var(--radius-container)] p-5 w-full max-w-sm mx-4 glass-surface shadow-2xl font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="edit-bookmark-title" className="text-foreground font-bold mb-4">
          {t('bookmarks.editBookmark')}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground text-xs block mb-1">{t('bookmarks.name')}</label>
            <input
              value={editModal.name}
              onChange={(e) => onChangeModal({ ...editModal, name: e.target.value })}
              className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
              autoFocus
            />
          </div>
          <div>
            <label className="text-muted-foreground text-xs block mb-1">{t('bookmarks.url')}</label>
            <input
              value={editModal.url}
              onChange={(e) => onChangeModal({ ...editModal, url: e.target.value })}
              className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            className="flex-1 py-2.5 rounded-full text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground bg-surface-hover border border-border-medium"
            onClick={onClose}
          >
            {t('bookmarks.cancel')}
          </button>
          <button
            className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200 hover:scale-[1.02] bg-primary/90 text-foreground shadow-primary/40 shadow-lg"
            onClick={onSave}
          >
            {t('bookmarks.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
