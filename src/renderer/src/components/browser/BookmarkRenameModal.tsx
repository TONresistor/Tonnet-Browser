import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface RenameModalState {
  folderId: string
  name: string
}

interface BookmarkRenameModalProps {
  renameModal: RenameModalState
  onChangeModal: (modal: RenameModalState) => void
  onSave: () => void
  onClose: () => void
}

export function BookmarkRenameModal({ renameModal, onChangeModal, onSave, onClose }: BookmarkRenameModalProps) {
  const { t } = useTranslation('settings')
  const renameModalRef = useRef<HTMLDivElement>(null)

  useFocusTrap(renameModalRef, true)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-folder-title"
    >
      <div
        ref={renameModalRef}
        className="rounded-[var(--radius-container)] p-5 w-full max-w-sm mx-4 glass-surface shadow-2xl font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="rename-folder-title" className="text-foreground font-bold mb-4">
          {t('bookmarks.renameFolder')}
        </h3>
        <input
          value={renameModal.name}
          onChange={(e) => onChangeModal({ ...renameModal, name: e.target.value })}
          className="w-full px-3 py-2 rounded-full text-sm text-foreground outline-none bg-surface-hover border border-border-medium"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSave()
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
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
