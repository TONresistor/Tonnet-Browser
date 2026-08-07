import type { ThemeColors } from '@shared/types'
import { THEME_TOKEN_GROUPS } from '@shared/theme-tokens'
import { InsetGroup } from '@/components/ui/ios/InsetGroup'
import { ThemeColorField } from './ThemeColorField'
import { useTranslation } from 'react-i18next'

interface ThemeSettingsProps {
  colors: ThemeColors
  disabled?: boolean
  readOnly?: boolean
  onChange?: (key: keyof ThemeColors, value: string) => void
}

export function ThemeSettings({ colors, disabled = false, readOnly = false, onChange }: ThemeSettingsProps) {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-5">
      {THEME_TOKEN_GROUPS.map((group) => (
        <InsetGroup
          key={group.id}
          title={t(`themeEditor.sections.${group.id}`)}
          bodyClassName="divide-y divide-border-subtle"
        >
          {group.keys.map((key) => (
            <ThemeColorField
              key={key}
              label={t(`themeEditor.colors.${key}`)}
              description={t(`themeEditor.colors.${key}Desc`)}
              value={colors[key]}
              disabled={disabled}
              readOnly={readOnly}
              onChange={readOnly ? undefined : (value) => onChange?.(key, value)}
            />
          ))}
        </InsetGroup>
      ))}
    </div>
  )
}
