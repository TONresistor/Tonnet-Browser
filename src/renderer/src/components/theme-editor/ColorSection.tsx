/**
 * Color section component for grouping related colors.
 */

import type { ThemeColors } from '@shared/types'
import { ColorInput } from './ColorInput'

// Human-readable labels for color keys
const COLOR_LABELS: Record<keyof ThemeColors, { label: string; description?: string }> = {
  background: { label: 'Background', description: 'Main background' },
  backgroundSecondary: { label: 'Secondary Background', description: 'Sidebar, panels' },
  foreground: { label: 'Foreground', description: 'Main text color' },
  card: { label: 'Card', description: 'Card backgrounds' },
  cardForeground: { label: 'Card Text' },
  primary: { label: 'Primary', description: 'Buttons, links' },
  primaryForeground: { label: 'Primary Text' },
  secondary: { label: 'Secondary' },
  secondaryForeground: { label: 'Secondary Text' },
  accent: { label: 'Accent', description: 'Highlights' },
  accentForeground: { label: 'Accent Text' },
  muted: { label: 'Muted', description: 'Subtle backgrounds' },
  mutedForeground: { label: 'Muted Text', description: 'Secondary text' },
  destructive: { label: 'Destructive', description: 'Errors, delete' },
  destructiveForeground: { label: 'Destructive Text' },
  success: { label: 'Success', description: 'Connected, valid' },
  successForeground: { label: 'Success Text' },
  warning: { label: 'Warning', description: 'Caution states' },
  warningForeground: { label: 'Warning Text' },
  info: { label: 'Info', description: 'Information' },
  infoForeground: { label: 'Info Text' },
  border: { label: 'Border', description: 'Default borders' },
  input: { label: 'Input', description: 'Input backgrounds' },
  ring: { label: 'Ring', description: 'Focus ring' },
}

interface ColorSectionProps {
  title: string
  colorKeys: (keyof ThemeColors)[]
  colors: ThemeColors
  onChange: (key: keyof ThemeColors, value: string) => void
}

export function ColorSection({ title, colorKeys, colors, onChange }: ColorSectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground border-b border-border-subtle pb-2">
        {title}
      </h4>
      <div className="grid grid-cols-2 gap-3">
        {colorKeys.map((key) => {
          const info = COLOR_LABELS[key]
          return (
            <ColorInput
              key={key}
              label={info.label}
              description={info.description}
              value={colors[key]}
              onChange={(value) => onChange(key, value)}
            />
          )
        })}
      </div>
    </div>
  )
}

export default ColorSection
