import { useRef } from 'react'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useTranslation } from 'react-i18next'

interface ThemeDeleteDialogProps {
  themeName: string | null
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ThemeDeleteDialog({ themeName, isDeleting, onCancel, onConfirm }: ThemeDeleteDialogProps) {
  const { t } = useTranslation('settings')
  const dialogRef = useRef<HTMLDivElement>(null)
  const isOpen = themeName !== null

  useFocusTrap(dialogRef, isOpen)

  if (themeName === null) return null

  const cancel = () => {
    if (!isDeleting) onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4 backdrop-blur-sm"
      onClick={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-theme-title"
      aria-describedby="delete-theme-description"
      aria-busy={isDeleting}
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-sm rounded-panel border border-border-subtle bg-elevation-1 p-6 shadow-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="delete-theme-title" className="mb-2 text-center text-[17px] font-semibold text-heading">
          {t('appearance.customThemes.deleteConfirm', { name: themeName })}
        </h2>
        <p id="delete-theme-description" className="mb-6 text-center text-sm leading-relaxed text-muted-foreground">
          {t('appearance.customThemes.deleteWarning')}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={cancel}
            disabled={isDeleting}
            autoFocus
            className="flex-1 rounded-full border border-border-subtle bg-surface-hover py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-active disabled:opacity-50"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            {t('common:buttons.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
