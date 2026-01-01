/**
 * Theme preview component - reflects actual app UI.
 */

import { Minus, Square, X } from 'lucide-react'
import type { ThemeColors } from '@shared/types'

interface ThemePreviewProps {
  colors: ThemeColors
  isDark: boolean
}

export function ThemePreview({ colors, isDark }: ThemePreviewProps) {
  // Generate CSS custom properties for isolated preview
  const style = {
    '--preview-background': `hsl(${colors.background})`,
    '--preview-background-secondary': `hsl(${colors.backgroundSecondary})`,
    '--preview-foreground': `hsl(${colors.foreground})`,
    '--preview-card': `hsl(${colors.card})`,
    '--preview-card-foreground': `hsl(${colors.cardForeground})`,
    '--preview-primary': `hsl(${colors.primary})`,
    '--preview-primary-foreground': `hsl(${colors.primaryForeground})`,
    '--preview-muted': `hsl(${colors.muted})`,
    '--preview-muted-foreground': `hsl(${colors.mutedForeground})`,
    '--preview-accent': `hsl(${colors.accent})`,
    '--preview-destructive': `hsl(${colors.destructive})`,
    '--preview-success': `hsl(${colors.success})`,
    '--preview-warning': `hsl(${colors.warning})`,
    '--preview-border': `hsl(${colors.border})`,
    '--preview-surface': isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
  } as React.CSSProperties

  return (
    <div
      className="rounded-lg overflow-hidden border border-border-medium"
      style={style}
    >
      {/* Tab bar + Window controls */}
      <div
        className="px-2 py-1.5 flex items-center gap-2"
        style={{ backgroundColor: 'var(--preview-background)' }}
      >
        {/* Tabs */}
        <div className="flex gap-1 flex-1">
          <div
            className="px-3 py-1 rounded-full text-xs flex items-center gap-1.5"
            style={{
              backgroundColor: 'var(--preview-surface)',
              color: 'var(--preview-foreground)',
              border: `1px solid var(--preview-border)`,
            }}
          >
            <span>Tab 1</span>
            <X className="w-3 h-3" style={{ color: 'var(--preview-muted-foreground)' }} />
          </div>
          <div
            className="px-3 py-1 rounded-full text-xs"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--preview-muted-foreground)',
              border: `1px solid transparent`,
            }}
          >
            Tab 2
          </div>
        </div>

        {/* Window controls */}
        <div className="flex">
          <div className="w-6 h-5 flex items-center justify-center" style={{ color: 'var(--preview-foreground)' }}>
            <Minus className="w-3 h-3" />
          </div>
          <div className="w-6 h-5 flex items-center justify-center" style={{ color: 'var(--preview-foreground)' }}>
            <Square className="w-2.5 h-2.5" />
          </div>
          <div className="w-6 h-5 flex items-center justify-center" style={{ color: 'var(--preview-foreground)' }}>
            <X className="w-3 h-3" />
          </div>
        </div>
      </div>

      {/* Address bar */}
      <div
        className="px-2 py-1.5 flex items-center gap-2"
        style={{ backgroundColor: 'var(--preview-background)' }}
      >
        <div
          className="flex-1 h-7 rounded-full px-3 flex items-center text-xs"
          style={{
            backgroundColor: 'var(--preview-surface)',
            color: 'var(--preview-muted-foreground)',
            border: `1px solid var(--preview-border)`,
          }}
        >
          foundation.ton
        </div>
      </div>

      {/* Content area */}
      <div
        className="p-3 min-h-[160px]"
        style={{ backgroundColor: 'var(--preview-background-secondary)' }}
      >
        {/* Card */}
        <div
          className="rounded-lg p-3 mb-3"
          style={{
            backgroundColor: 'var(--preview-card)',
            border: `1px solid var(--preview-border)`,
          }}
        >
          <h3
            className="text-sm font-semibold mb-1"
            style={{ color: 'var(--preview-card-foreground)' }}
          >
            Card Title
          </h3>
          <p
            className="text-xs"
            style={{ color: 'var(--preview-muted-foreground)' }}
          >
            Preview of your theme.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mb-3">
          <button
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: 'var(--preview-primary)',
              color: 'var(--preview-primary-foreground)',
            }}
          >
            Primary
          </button>
          <button
            className="px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: 'var(--preview-surface)',
              color: 'var(--preview-foreground)',
              border: `1px solid var(--preview-border)`,
            }}
          >
            Secondary
          </button>
        </div>

        {/* Status indicators */}
        <div className="flex gap-3 text-xs">
          <span
            className="flex items-center gap-1"
            style={{ color: 'var(--preview-success)' }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'currentColor' }} />
            Connected
          </span>
          <span
            className="flex items-center gap-1"
            style={{ color: 'var(--preview-warning)' }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'currentColor' }} />
            Syncing
          </span>
        </div>
      </div>
    </div>
  )
}

export default ThemePreview
