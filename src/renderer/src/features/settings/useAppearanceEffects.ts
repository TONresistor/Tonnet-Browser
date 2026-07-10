import { useEffect, useState } from 'react'
import i18n, { loadLanguage } from '@/i18n'
import { createLogger } from '@/logger'
import { applyCustomTheme, parseCustomThemeId, removeCustomTheme } from '@/lib/theme-utils'
import { usePreferencesStore } from './preferences-store'
import { useThemeStore } from './theme-store'

const log = createLogger('appearance')

function isLightTheme(theme: string, customThemes: { id: string; isDark: boolean }[]): boolean {
  const customId = parseCustomThemeId(theme)
  return (
    theme === 'utya-duck' || (customId !== null && customThemes.find((item) => item.id === customId)?.isDark === false)
  )
}

export function useAppearanceEffects(): unknown {
  const theme = usePreferencesStore((state) => state.saved.theme)
  const language = usePreferencesStore((state) => state.saved.language)
  const customThemes = useThemeStore((state) => state.customThemes)
  const [animationData, setAnimationData] = useState<unknown>(null)

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

  useEffect(() => {
    let cancelled = false
    const animation = isLightTheme(theme, customThemes)
      ? import('@/assets/loading-yellow.json')
      : import('@/assets/loading.json')
    void animation.then((module) => {
      if (!cancelled) setAnimationData(module.default)
    })
    return () => {
      cancelled = true
    }
  }, [theme, customThemes])

  return animationData
}
