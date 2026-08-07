import { useEffect } from 'react'
import i18n, { loadLanguage } from '@/i18n'
import { createLogger } from '@/logger'
import { usePreferencesStore } from './preferences-store'

const log = createLogger('locale')

export function useLocaleEffects(): void {
  const language = usePreferencesStore((state) => state.saved.language)

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
}
