import { useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useTranslation } from 'react-i18next'

interface ThemeDiscardDialogProps {
  isOpen: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ThemeDiscardDialog({ isOpen, onCancel, onConfirm }: ThemeDiscardDialogProps) {
  const { t } = useTranslation('settings')
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap(dialogRef, isOpen)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-theme-title"
      aria-describedby="discard-theme-description"
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-sm rounded-panel border border-border-subtle bg-elevation-1 p-6 shadow-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="discard-theme-title" className="mb-2 text-center text-[17px] font-semibold text-heading">
          {t('actions.unsavedChanges')}
        </h2>
        <p id="discard-theme-description" className="mb-6 text-center text-sm leading-relaxed text-muted-foreground">
          {t('actions.discardWarning')}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="flex-1 rounded-full border border-border-subtle bg-surface-hover py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-active"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {t('actions.discard')}
          </button>
        </div>
      </div>
    </div>
  )
}
