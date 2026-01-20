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
import { ThemeEditor, ThemeList, ImportDialog, ExportDialog } from '@/components/theme-editor'
import { useThemeStore } from '@/stores/themes'
import type { SectionProps } from '../types'
import type { BuiltInTheme } from '@shared/defaults'

export const AppearanceSection = memo(function AppearanceSection({
  draft,
  setDraft,
}: SectionProps) {
  const builtInThemes = [
    {
      value: 'resistance-dog',
      label: 'Resistance Dog',
      description: 'Dark blue theme (default)',
      color: 'bg-[#5288c1]',
    },
    {
      value: 'utya-duck',
      label: 'Utya Duck',
      description: 'Bright yellow theme',
      color: 'bg-[#FFE600]',
    },
  ]

  const {
    customThemes,
    createTheme,
    deleteTheme,
    duplicateTheme,
    exportTheme,
    importTheme,
  } = useThemeStore()

  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [exportData, setExportData] = useState<{ json: string; name: string } | null>(null)
  const [showCreateMenu, setShowCreateMenu] = useState(false)

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
    const theme = customThemes.find((t) => t.id === themeId)
    if (theme && confirm(`Delete "${theme.name}"?`)) {
      if (draft.theme === `custom:${themeId}`) {
        setDraft('theme', 'resistance-dog')
      }
      deleteTheme(themeId)
    }
  }

  const handleEditorSave = () => {
    setEditingThemeId(null)
  }

  return (
    <div>
      <SectionHeader title="Appearance" description="Customize how the browser looks" />

      {/* Built-in themes */}
      <div className="bg-card rounded-xl border border-border px-4">
        <SettingRow label="Theme" description="Choose color scheme">
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
            <h4 className="text-sm font-semibold text-foreground">Custom Themes</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create and manage your own themes
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowImportDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors bg-surface hover:bg-surface-hover"
            >
              <Upload className="w-4 h-4" />
              Import
            </button>
            <div className="relative">
              <button
                onClick={() => setShowCreateMenu(!showCreateMenu)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Create
              </button>
              {showCreateMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowCreateMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                    <button
                      onClick={() => handleCreateTheme('resistance-dog')}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      Based on Dark theme
                    </button>
                    <button
                      onClick={() => handleCreateTheme('utya-duck')}
                      className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover transition-colors"
                    >
                      Based on Light theme
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
          onEdit={setEditingThemeId}
          onDelete={handleDelete}
          onDuplicate={duplicateTheme}
          onExport={handleExport}
          onSelect={handleSelectCustomTheme}
        />
      </div>

      {/* Other appearance settings */}
      <div className="mt-6 bg-card rounded-xl border border-border px-4">
        <SettingRow label="Default zoom" description="Initial zoom level for pages">
          <NumberInput
            value={draft.defaultZoom}
            onChange={(v) => setDraft('defaultZoom', v)}
            min={30}
            max={300}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label="Minimum zoom" description="Lowest allowed zoom level">
          <NumberInput
            value={draft.zoomMin}
            onChange={(v) => setDraft('zoomMin', v)}
            min={10}
            max={100}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label="Maximum zoom" description="Highest allowed zoom level">
          <NumberInput
            value={draft.zoomMax}
            onChange={(v) => setDraft('zoomMax', v)}
            min={100}
            max={500}
            step={10}
            suffix="%"
          />
        </SettingRow>
        <SettingRow label="Show bookmarks bar" description="Display quick access bookmarks">
          <Toggle
            checked={draft.showBookmarksBar}
            onChange={(v) => setDraft('showBookmarksBar', v)}
            label="Show bookmarks bar"
          />
        </SettingRow>
        <SettingRow label="Show status bar" description="Display connection status at bottom">
          <Toggle
            checked={draft.showStatusBar}
            onChange={(v) => setDraft('showStatusBar', v)}
            label="Show status bar"
          />
        </SettingRow>
      </div>

      {/* Theme Editor Modal */}
      {editingThemeId && (
        <ThemeEditor
          themeId={editingThemeId}
          onClose={() => setEditingThemeId(null)}
          onSave={handleEditorSave}
        />
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <ImportDialog onImport={handleImport} onClose={() => setShowImportDialog(false)} />
      )}

      {/* Export Dialog */}
      {exportData && (
        <ExportDialog
          themeJson={exportData.json}
          themeName={exportData.name}
          onClose={() => setExportData(null)}
        />
      )}
    </div>
  )
})
