/**
 * Color section component for grouping related colors.
 */

import type { ThemeColors } from '@shared/types'
import { ColorInput } from './ColorInput'
import { useTranslation } from 'react-i18next'

// Color keys that have a description in i18n
const DESCRIBED_COLORS = new Set<string>([
  'background',
  'backgroundSecondary',
  'foreground',
  'card',
  'primary',
  'accent',
  'muted',
  'mutedForeground',
  'destructive',
  'success',
  'warning',
  'info',
  'border',
  'input',
  'ring',
])

interface ColorSectionProps {
  title: string
  colorKeys: (keyof ThemeColors)[]
  colors: ThemeColors
  onChange: (key: keyof ThemeColors, value: string) => void
}

export function ColorSection({ title, colorKeys, colors, onChange }: ColorSectionProps) {
  const { t } = useTranslation('settings')
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground border-b border-border-subtle pb-2">{title}</h4>
      <div className="grid grid-cols-2 gap-3">
        {colorKeys.map((key) => {
          return (
            <ColorInput
              key={key}
              label={t(`themeEditor.colors.${key}`)}
              description={DESCRIBED_COLORS.has(key) ? t(`themeEditor.colors.${key}Desc`) : undefined}
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
