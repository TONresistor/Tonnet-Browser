/**
 * Theme editor modal component.
 */

import { useState, useEffect } from 'react'
import { X, Check, RotateCcw, Sun, Moon } from 'lucide-react'
import type { ThemeColors } from '@shared/types'
import { useThemeStore } from '../../stores/themes'
import { RESISTANCE_DOG_COLORS, UTYA_DUCK_COLORS } from '../../lib/theme-utils'
import { ColorSection } from './ColorSection'
import { ThemePreview } from './ThemePreview'
import { useTranslation } from 'react-i18next'

interface ThemeEditorProps {
  themeId: string
  onClose: () => void
  onSave: () => void
}

// Color sections for organized editing
const COLOR_SECTIONS = [
  {
    titleKey: 'themeEditor.sections.background',
    keys: ['background', 'backgroundSecondary', 'card'] as (keyof ThemeColors)[],
  },
  {
    titleKey: 'themeEditor.sections.text',
    keys: ['foreground', 'cardForeground', 'mutedForeground'] as (keyof ThemeColors)[],
  },
  {
    titleKey: 'themeEditor.sections.primaryAccent',
    keys: ['primary', 'primaryForeground', 'accent', 'accentForeground'] as (keyof ThemeColors)[],
  },
  {
    titleKey: 'themeEditor.sections.secondaryMuted',
    keys: ['secondary', 'secondaryForeground', 'muted'] as (keyof ThemeColors)[],
  },
  {
    titleKey: 'themeEditor.sections.statusColors',
    keys: [
      'success',
      'successForeground',
      'warning',
      'warningForeground',
      'destructive',
      'destructiveForeground',
      'info',
      'infoForeground',
    ] as (keyof ThemeColors)[],
  },
  {
    titleKey: 'themeEditor.sections.borderInput',
    keys: ['border', 'input', 'ring'] as (keyof ThemeColors)[],
  },
]

export function ThemeEditor({ themeId, onClose, onSave }: ThemeEditorProps) {
  const { t } = useTranslation('settings')
  const { customThemes, updateTheme, saveToSettings } = useThemeStore()
  const theme = customThemes.find((t) => t.id === themeId)

  const [localColors, setLocalColors] = useState<ThemeColors | null>(null)
  const [localName, setLocalName] = useState('')
  const [localDescription, setLocalDescription] = useState('')
  const [localIsDark, setLocalIsDark] = useState(true)

  // Initialize local state when theme loads
  useEffect(() => {
    if (theme) {
      setLocalColors({ ...theme.colors })
      setLocalName(theme.name)
      setLocalDescription(theme.description || '')
      setLocalIsDark(theme.isDark)
    }
  }, [theme])

  if (!theme || !localColors) {
    return null
  }

  const handleColorChange = (key: keyof ThemeColors, value: string) => {
    setLocalColors((prev) => (prev ? { ...prev, [key]: value } : null))
  }

  const handleSave = async () => {
    updateTheme(themeId, {
      name: localName,
      description: localDescription || undefined,
      colors: localColors,
      isDark: localIsDark,
    })
    await saveToSettings()
    onSave()
  }

  const handleReset = (base: 'resistance-dog' | 'utya-duck') => {
    const baseColors = base === 'resistance-dog' ? RESISTANCE_DOG_COLORS : UTYA_DUCK_COLORS
    setLocalColors({ ...baseColors })
    setLocalIsDark(base === 'resistance-dog')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex-1">
            <input
              type="text"
              value={localName}
              onChange={(e) => setLocalName(e.target.value)}
              className="text-lg font-semibold bg-transparent border-none outline-none text-foreground w-full"
              placeholder={t('themeEditor.editor.themeName')}
            />
            <input
              type="text"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              className="text-sm text-muted-foreground bg-transparent border-none outline-none w-full mt-1"
              placeholder={t('themeEditor.editor.descriptionPlaceholder')}
            />
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Color inputs */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Theme type toggle */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-surface">
              <span className="text-sm font-medium">{t('themeEditor.editor.themeType')}</span>
              <button
                onClick={() => setLocalIsDark(true)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  localIsDark ? 'bg-primary text-primary-foreground' : 'bg-surface-hover text-muted-foreground'
                }`}
              >
                <Moon className="w-4 h-4" />
                {t('themeEditor.editor.dark')}
              </button>
              <button
                onClick={() => setLocalIsDark(false)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  !localIsDark ? 'bg-primary text-primary-foreground' : 'bg-surface-hover text-muted-foreground'
                }`}
              >
                <Sun className="w-4 h-4" />
                {t('themeEditor.editor.light')}
              </button>
            </div>

            {/* Color sections */}
            {COLOR_SECTIONS.map((section) => (
              <ColorSection
                key={section.titleKey}
                title={t(section.titleKey)}
                colorKeys={section.keys}
                colors={localColors}
                onChange={handleColorChange}
              />
            ))}
          </div>

          {/* Right: Preview */}
          <div className="w-[340px] border-l border-border p-6 flex flex-col gap-4 bg-background-secondary">
            <h3 className="text-sm font-semibold">{t('themeEditor.editor.preview')}</h3>

            <ThemePreview colors={localColors} isDark={localIsDark} />

            {/* Reset buttons */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('themeEditor.editor.resetToBase')}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReset('resistance-dog')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface hover:bg-surface-hover text-sm transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('themeEditor.editor.dark')}
                </button>
                <button
                  onClick={() => handleReset('utya-duck')}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-surface hover:bg-surface-hover text-sm transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t('themeEditor.editor.light')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-background-secondary">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover text-foreground transition-colors"
          >
            {t('themeEditor.editor.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Check className="w-4 h-4" />
            {t('themeEditor.editor.saveTheme')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ThemeEditor
