/**
 * List of custom themes with actions.
 */

import { Pencil, Trash2, Copy, Download, Check } from 'lucide-react'
import type { CustomTheme } from '@shared/types'
import { hslToHex } from '../../lib/theme-utils'

interface ThemeListProps {
  themes: CustomTheme[]
  selectedThemeId?: string
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onExport: (id: string) => void
  onSelect: (id: string) => void
}

export function ThemeList({
  themes,
  selectedThemeId,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
  onSelect,
}: ThemeListProps) {
  if (themes.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No custom themes yet. Create one to get started.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {themes.map((theme) => {
        const isSelected = selectedThemeId === `custom:${theme.id}`
        const previewColors = [
          theme.colors.background,
          theme.colors.primary,
          theme.colors.accent,
          theme.colors.success,
        ]

        return (
          <div
            key={theme.id}
            className={`group flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
              isSelected
                ? 'border-primary bg-primary/10'
                : 'border-border-subtle hover:border-border-medium hover:bg-surface-hover'
            }`}
            onClick={() => onSelect(theme.id)}
          >
            {/* Color preview dots */}
            <div className="flex gap-1">
              {previewColors.map((color, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-full border border-border-subtle"
                  style={{ backgroundColor: hslToHex(color) }}
                />
              ))}
            </div>

            {/* Theme info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-foreground truncate">
                  {theme.name}
                </span>
                {isSelected && (
                  <Check className="w-4 h-4 text-primary flex-shrink-0" />
                )}
              </div>
              {theme.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {theme.description}
                </p>
              )}
              <p className="text-xs text-foreground-muted">
                {theme.isDark ? 'Dark' : 'Light'} theme
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(theme.id)
                }}
                className="p-1.5 rounded-md hover:bg-surface-active text-muted-foreground hover:text-foreground transition-colors"
                title="Edit theme"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDuplicate(theme.id)
                }}
                className="p-1.5 rounded-md hover:bg-surface-active text-muted-foreground hover:text-foreground transition-colors"
                title="Duplicate theme"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onExport(theme.id)
                }}
                className="p-1.5 rounded-md hover:bg-surface-active text-muted-foreground hover:text-foreground transition-colors"
                title="Export theme"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(theme.id)
                }}
                className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                title="Delete theme"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ThemeList
