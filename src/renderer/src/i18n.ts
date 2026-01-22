/**
 * i18n configuration
 * Internationalization setup for the application
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// Import translations
import commonEn from './locales/en/common.json'
import landingEn from './locales/en/landing.json'
import browserEn from './locales/en/browser.json'
import settingsEn from './locales/en/settings.json'
import storageEn from './locales/en/storage.json'

import commonRu from './locales/ru/common.json'
import landingRu from './locales/ru/landing.json'
import browserRu from './locales/ru/browser.json'
import settingsRu from './locales/ru/settings.json'
import storageRu from './locales/ru/storage.json'

// Initialize i18next
i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: commonEn,
        landing: landingEn,
        browser: browserEn,
        settings: settingsEn,
        storage: storageEn,
      },
      ru: {
        common: commonRu,
        landing: landingRu,
        browser: browserRu,
        settings: settingsRu,
        storage: storageRu,
      },
    },
    lng: 'en', // Default language (will be overridden by settings)
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'landing', 'browser', 'settings', 'storage'],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false, // Disable suspense for Electron compatibility
    },
  })

export default i18n
