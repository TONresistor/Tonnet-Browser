import { useEffect } from 'react'
import i18n, { loadLanguage } from '@/i18n'
import { createLogger } from '@/logger'
import { applyCustomTheme, parseCustomThemeId, removeCustomTheme } from '@/lib/theme-utils'
import { usePreferencesStore } from './preferences-store'
import { useThemeStore } from './theme-store'

const log = createLogger('appearance')

export function useAppearanceEffects(): void {
  const theme = usePreferencesStore((state) => state.saved.theme)
  const language = usePreferencesStore((state) => state.saved.language)
  const customThemes = useThemeStore((state) => state.customThemes)

  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [])

  useEffect(() => {
    if (language && i18n.language !== language) {
      loadLanguage(language)
        .then(() => {
          document.documentElement.lang = i18n.language
        })
        .catch((error) => log.error('Failed to load language:', error))
    }
  }, [language])

  useEffect(() => {
    const customThemeId = parseCustomThemeId(theme)
    if (customThemeId !== null) {
      const customTheme = customThemes.find((item) => item.id === customThemeId)
      if (customTheme) {
        applyCustomTheme(customTheme)
      } else {
        removeCustomTheme()
        document.documentElement.setAttribute('data-theme', 'resistance-dog')
      }
    } else {
      removeCustomTheme()
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [theme, customThemes])
}
