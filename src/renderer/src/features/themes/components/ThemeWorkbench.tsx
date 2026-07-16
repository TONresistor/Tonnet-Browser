import { useState } from 'react'
import { Save } from 'lucide-react'
import type { CustomTheme, ThemeColors } from '@shared/types'
import type { ThemeType } from '@shared/defaults'
import { errorMessage } from '@shared/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { useThemeDraftPreview } from '../useThemeDraftPreview'
import { isThemeDraftDirty } from '../model'
import { ThemeDetails } from './ThemeDetails'
import { ThemeSettings } from './ThemeSettings'
import type { ThemeChoice } from './types'
import { useTranslation } from 'react-i18next'

interface ThemeWorkbenchProps {
  choice: ThemeChoice
  theme: CustomTheme
  originalTheme: CustomTheme | null
  activeTheme: ThemeType
  isSaving: boolean
  isPreviewing: boolean
  canApply: boolean
  onChange: (theme: CustomTheme) => void
  onSave: (theme: CustomTheme) => Promise<void>
  onBack: () => void
  onApply: () => void
  onPreview: () => void
  onDuplicate: () => void
  onExport: () => void
  onDelete: () => void
}

export function ThemeWorkbench({
  choice,
  theme,
  originalTheme,
  activeTheme,
  isSaving,
  isPreviewing,
  canApply,
  onChange,
  onSave,
  onBack,
  onApply,
  onPreview,
  onDuplicate,
  onExport,
  onDelete,
}: ThemeWorkbenchProps) {
  const { t } = useTranslation('settings')
  const [error, setError] = useState('')
  const isDirty = isThemeDraftDirty(theme, originalTheme)
  useThemeDraftPreview(theme, isPreviewing)

  const changeTheme = (nextTheme: CustomTheme) => {
    setError('')
    onChange(nextTheme)
  }

  const updateColor = (key: keyof ThemeColors, value: string) => {
    changeTheme({ ...theme, colors: { ...theme.colors, [key]: value } })
  }

  const save = async () => {
    setError('')
    try {
      await onSave({
        ...theme,
        name: theme.name.trim(),
        description: theme.description?.trim() || undefined,
      })
    } catch (saveError) {
      setError(errorMessage(saveError))
    }
  }

  return (
    <section className="theme-workbench flex h-full min-h-0 flex-col" aria-busy={isSaving}>
      <div className="theme-workbench-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="theme-workbench-body mx-auto w-full max-w-[920px] min-w-0">
          <div className="min-w-0 space-y-5 p-5">
            <ThemeDetails
              choice={choice}
              activeTheme={activeTheme}
              isSaving={isSaving}
              isPreviewing={isPreviewing}
              canApply={canApply}
              onApply={onApply}
              onPreview={onPreview}
              onDuplicate={onDuplicate}
              onExport={onExport}
              onDelete={onDelete}
            />

            <InsetGroup title={t('appearance.theme.label')}>
              <div className="grid gap-3 p-3 theme-identity-grid">
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    {t('themeEditor.editor.themeName')}
                  </span>
                  <Input
                    value={theme.name}
                    disabled={isSaving}
                    onChange={(event) => changeTheme({ ...theme, name: event.target.value })}
                    className="rounded-field bg-elevation-1 shadow-none"
                  />
                </label>
                <label className="min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    {t('themeEditor.editor.descriptionPlaceholder')}
                  </span>
                  <Input
                    value={theme.description ?? ''}
                    disabled={isSaving}
                    onChange={(event) => changeTheme({ ...theme, description: event.target.value })}
                    className="rounded-field bg-elevation-1 shadow-none"
                  />
                </label>
              </div>
            </InsetGroup>

            <ThemeSettings colors={theme.colors} disabled={isSaving} onChange={updateColor} />
          </div>
        </div>
      </div>

      <footer className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-elevation-1/95 px-5 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && isDirty && <p className="text-xs text-muted-foreground">{t('actions.unsavedChanges')}</p>}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onBack} disabled={isSaving || !isDirty}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={isSaving || !theme.name.trim() || !isDirty} className="gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? t('actions.saving') : t('themeEditor.editor.saveTheme')}
          </Button>
        </div>
      </footer>
    </section>
  )
}
