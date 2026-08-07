import type { ThemeColors, CustomTheme } from '@shared/types'
import type { ThemeType } from '@shared/defaults'

export interface ThemeChoice {
  value: ThemeType
  name: string
  description?: string
  colors: ThemeColors
  isDark: boolean
  customTheme?: CustomTheme
}
