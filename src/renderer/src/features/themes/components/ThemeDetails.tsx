import { useCallback, useRef } from 'react'
import { Ellipsis, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOverlay } from '@/hooks/useOverlay'
import { clampToViewport } from '@/lib/overlay-position'
import type { ThemeType } from '@shared/defaults'
import type { OverlayMenuItem } from '@shared/types'
import type { ThemeChoice } from './types'
import { useTranslation } from 'react-i18next'

interface ThemeDetailsProps {
  choice: ThemeChoice
  activeTheme: ThemeType
  isSaving: boolean
  isPreviewing: boolean
  canApply?: boolean
  onApply: () => void
  onPreview: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}

export function ThemeDetails({
  choice,
  activeTheme,
  isSaving,
  isPreviewing,
  canApply = true,
  onApply,
  onPreview,
  onDuplicate,
  onExport,
  onDelete,
}: ThemeDetailsProps) {
  const { t } = useTranslation('settings')
  const isActive = choice.value === activeTheme
  const actionMenuRef = useRef<{ hide: () => void } | null>(null)

  const handleActionMenu = useCallback(
    (action: string) => {
      actionMenuRef.current?.hide()
      if (action === 'duplicate') onDuplicate()
      else if (action === 'export') onExport()
      else if (action === 'delete') onDelete()
    },
    [onDelete, onDuplicate, onExport]
  )

  const actionMenu = useOverlay('theme-detail-actions', handleActionMenu)
  actionMenuRef.current = actionMenu

  const openActionMenu = (button: HTMLButtonElement) => {
    const width = 220
    const height = 148
    const rect = button.getBoundingClientRect()
    const { x, y } = clampToViewport(rect.right - width, rect.bottom + 8, width, height, 8)
    const items: OverlayMenuItem[] = [
      { id: 'duplicate', label: t('themeEditor.list.duplicateTheme') },
      { id: 'export', label: t('themeEditor.list.exportTheme') },
      { id: 'separator', label: '', separator: true },
      {
        id: 'delete',
        label: t('themeEditor.list.deleteTheme'),
        destructive: true,
      },
    ]

    actionMenu.show({ x, y, width, height }, { type: 'menu', items })
  }

  return (
    <header className="theme-detail-commandbar border-b border-border-subtle pb-5">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold leading-6 tracking-tight text-heading">{choice.name}</h1>
        {choice.description && (
          <p className="mt-1 truncate text-[13px] leading-[18px] text-muted-foreground">{choice.description}</p>
        )}
      </div>

      <div className="theme-detail-actions flex min-h-9 shrink-0 items-center justify-end gap-2">
        {canApply && !isActive && (
          <Button onClick={onApply} disabled={isSaving} className="shrink-0">
            {isSaving ? t('actions.saving') : t('themePage.useTheme')}
          </Button>
        )}

        <Button
          variant={isPreviewing ? 'secondary' : 'outline'}
          onClick={onPreview}
          disabled={isSaving}
          className="gap-2"
          aria-pressed={isPreviewing}
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          {t('themeEditor.editor.preview')}
        </Button>

        {choice.customTheme && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => openActionMenu(event.currentTarget)}
            disabled={isSaving}
            title={t('themePage.moreActions')}
            aria-label={t('themePage.moreActions')}
            aria-haspopup="menu"
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  )
}
