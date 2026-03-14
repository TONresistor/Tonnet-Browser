/**
 * Section Appearance
 */

import { memo, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../shared/SectionHeader'
import { SettingRow } from '../shared/SettingRow'
import { Toggle } from '../shared/Toggle'
import { NumberInput } from '../shared/NumberInput'
import { SelectInput } from '../shared/SelectInput'
import { ThemeEditor, ThemeList, ImportDialog, ExportDialog } from '@/components/theme-editor'
import { useThemeStore } from '@/stores/themes'
import type { SectionProps } from '../types'
import type { BuiltInTheme } from '@shared/defaults'
import { useTranslation } from 'react-i18next'

export const AppearanceSection = memo(function AppearanceSection({ draft, setDraft }: SectionProps) {
  const { t } = useTranslation('settings')

  const builtInThemes = [
    {
      value: 'resistance-dog',
      label: t('appearance.theme.resistanceDog'),
      description: t('appearance.theme.resistanceDogDesc'),
      color: 'bg-[#5288c1]',
    },
    {
      value: 'utya-duck',
      label: t('appearance.theme.utyaDuck'),
      description: t('appearance.theme.utyaDuckDesc'),
      color: 'bg-[#FFE600]',
    },
  ]

  const { customThemes, createTheme, deleteTheme, duplicateTheme, exportTheme, importTheme } = useThemeStore()

  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [exportData, setExportData] = useState<{ json: string; name: string } | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const handleCreateTheme = (base: 'resistance-dog' | 'utya-duck') => {
    const theme = createTheme(base, `Custom Theme ${customThemes.length + 1}`)
    setShowCreateMenu(false)
    setEditingThemeId(theme.id)
  }

  const handleSelectCustomTheme = (themeId: string) => {
    setDraft('theme', `custom:${themeId}`)
  }

  const handleExport = (themeId: string) => {
    const json = exportTheme(themeId)
    const theme = customThemes.find((t) => t.id === themeId)
    if (json && theme) {
      setExportData({ json, name: theme.name })
    }
  }

  const handleImport = (json: string): boolean => {
    const theme = importTheme(json)
    return theme !== null
  }

  const handleDelete = (themeId: string) => {
    if (pendingDeleteId === themeId) {
      if (draft.theme === `custom:${themeId}`) {
        setDraft('theme', 'resistance-dog')
      }
      deleteTheme(themeId)
      setPendingDeleteId(null)
    } else {
      setPendingDeleteId(themeId)
      setTimeout(() => setPendingDeleteId(null), 3000)
    }
  }

  const handleEditorSave = () => {
    setEditingThemeId(null)
  }

  const languageOptions = [
    { value: 'en', label: t('appearance.language.english') },
    { value: 'ru', label: t('appearance.language.russian') },
    { value: 'zh', label: t('appearance.language.chinese') },
    { value: 'es', label: t('appearance.language.spanish') },
    { value: 'id', label: t('appearance.language.indonesian') },
    { value: 'th', label: t('appearance.language.thai') },
    { value: 'de', label: t('appearance.language.german') },
    { value: 'fr', label: t('appearance.language.french') },
    { value: 'pt', label: t('appearance.language.portuguese') },
    { value: 'ko', label: t('appearance.language.korean') },
  ]

  return (
    <div>
      <SectionHeader title={t('appearance.title')} description={t('appearance.description')} />

      {/* Language selector */}
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label={t('appearance.language.label')} description={t('appearance.language.description')}>
          <SelectInput value={draft.language} onChange={(v) => setDraft('language', v)} options={languageOptions} />
        </SettingRow>
      </div>

      {/* Built-in themes */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label={t('appearance.theme.label')} description={t('appearance.theme.description')}>
          <div className="flex gap-2">
            {builtInThemes.map((theme) => (
              <button
                key={theme.value}
                onClick={() => setDraft('theme', theme.value as BuiltInTheme)}
                className={cn(
                  'flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors min-w-[100px]',
                  draft.theme === theme.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50 bg-background-secondary'
                )}
              >
                <div className={cn('w-8 h-8 rounded-full', theme.color)} />
                <span className="text-xs text-foreground">{theme.label}</span>
              </button>
            ))}
          </div>
        </SettingRow>
      </div>

      {/* Custom themes section */}
      <div className="mt-6 bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">{t('appearance.customThemes.title')}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{t('appearance.customThemes.description')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowImportDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors bg-surface hover:bg-surface-hover"
            >
              <Upload className="w-4 h-4" />
              {t('common:buttons.import')}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowCreateMenu(!showCreateMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                {t('common:buttons.create')}
              </button>
              {showCreateMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCreateMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                    <button
                      onClick={() => handleCreateTheme('resistance-dog')}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      {t('appearance.customThemes.basedOnDark')}
                    </button>
                    <button
                      onClick={() => handleCreateTheme('utya-duck')}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      {t('appearance.customThemes.basedOnLight')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <ThemeList
          themes={customThemes}
          selectedThemeId={draft.theme}
          pendingDeleteId={pendingDeleteId}
          onEdit={setEditingThemeId}
          onDelete={handleDelete}
          onDuplicate={duplicateTheme}
          onExport={handleExport}
          onSelect={handleSelectCustomTheme}
        />
      </div>

      {/* Other appearance settings */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label={t('appearance.zoom.default')} description={t('appearance.zoom.defaultDesc')}>
          <NumberInput
            value={draft.defaultZoom}
            onChange={(v) => setDraft('defaultZoom', v)}
            min={30}
            max={300}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label={t('appearance.zoom.min')} description={t('appearance.zoom.minDesc')}>
          <NumberInput
            value={draft.zoomMin}
            onChange={(v) => setDraft('zoomMin', v)}
            min={10}
            max={100}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label={t('appearance.zoom.max')} description={t('appearance.zoom.maxDesc')}>
          <NumberInput
            value={draft.zoomMax}
            onChange={(v) => setDraft('zoomMax', v)}
            min={100}
            max={500}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <div className="border-t border-border" />
        <SettingRow label={t('appearance.ui.showBookmarksBar')} description={t('appearance.ui.showBookmarksBarDesc')}>
          <Toggle
            checked={draft.showBookmarksBar}
            onChange={(v) => setDraft('showBookmarksBar', v)}
            label={t('appearance.ui.showBookmarksBar')}
          />
        </SettingRow>
        <SettingRow label={t('appearance.ui.showStatusBar')} description={t('appearance.ui.showStatusBarDesc')}>
          <Toggle
            checked={draft.showStatusBar}
            onChange={(v) => setDraft('showStatusBar', v)}
            label={t('appearance.ui.showStatusBar')}
          />
        </SettingRow>
        <SettingRow label={t('appearance.ui.tabOrientation')} description={t('appearance.ui.tabOrientationDesc')}>
          <SelectInput
            value={draft.tabOrientation}
            onChange={(v) => setDraft('tabOrientation', v as 'horizontal' | 'vertical')}
            options={[
              { value: 'horizontal', label: t('appearance.ui.tabOrientationHorizontal') },
              { value: 'vertical', label: t('appearance.ui.tabOrientationVertical') },
            ]}
          />
        </SettingRow>
      </div>

      {/* Theme Editor Modal */}
      {editingThemeId && (
        <ThemeEditor themeId={editingThemeId} onClose={() => setEditingThemeId(null)} onSave={handleEditorSave} />
      )}

      {/* Import Dialog */}
      {showImportDialog && <ImportDialog onImport={handleImport} onClose={() => setShowImportDialog(false)} />}

      {/* Export Dialog */}
      {exportData && (
        <ExportDialog themeJson={exportData.json} themeName={exportData.name} onClose={() => setExportData(null)} />
      )}
    </div>
  )
})
