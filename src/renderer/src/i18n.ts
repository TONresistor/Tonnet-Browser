/**
 * i18n configuration with lazy loading
 * Internationalization setup for the application
 * Loads only the active language to reduce initial bundle size
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { createLogger } from '@/logger'

const log = createLogger('i18n')

// Import only English as default
import commonEn from './locales/en/common.json'
import landingEn from './locales/en/landing.json'
import browserEn from './locales/en/browser.json'
import settingsEn from './locales/en/settings.json'
import storageEn from './locales/en/storage.json'
import pagesEn from './locales/en/pages.json'
import walletEn from './locales/en/wallet.json'
import dnsEn from './locales/en/dns.json'

// Single source of truth for the translation namespaces.
const NAMESPACES = ['common', 'landing', 'browser', 'settings', 'storage', 'pages', 'wallet', 'dns'] as const
// Namespaces that may be missing in some locales: fall back to an empty bundle.
const OPTIONAL_NS = new Set<string>(['wallet', 'dns'])
const localeLoaders = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/*/*.json',
  '!./locales/en/*.json',
])

// Track which languages have been loaded
const loadedLanguages = new Set<string>(['en'])

// Initialize i18next with English only
i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
      landing: landingEn,
      browser: browserEn,
      settings: settingsEn,
      storage: storageEn,
      pages: pagesEn,
      wallet: walletEn,
      dns: dnsEn,
    },
  },
  lng: 'en', // Default language (will be overridden by settings)
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [...NAMESPACES],
  interpolation: {
    escapeValue: false, // React already escapes
  },
  react: {
    useSuspense: false, // Disable suspense for Electron compatibility
  },
})

/**
 * Dynamically load a language and its translations
 * @param lang - Language code (e.g., 'en', 'ru', 'zh')
 * @returns Promise that resolves when language is loaded and activated
 */
export async function loadLanguage(lang: string): Promise<void> {
  // If already loaded, just switch to it
  if (loadedLanguages.has(lang)) {
    await i18n.changeLanguage(lang)
    return
  }

  try {
    // Dynamic imports for the requested language, one per namespace.
    await Promise.all(
      NAMESPACES.map(async (ns) => {
        const loader = localeLoaders[`./locales/${lang}/${ns}.json`]
        if (!loader && !OPTIONAL_NS.has(ns)) throw new Error(`Unsupported locale: ${lang}/${ns}`)
        const mod = loader ? await loader() : { default: {} }
        i18n.addResourceBundle(lang, ns, mod.default)
      })
    )

    // Mark as loaded
    loadedLanguages.add(lang)

    // Switch to the new language
    await i18n.changeLanguage(lang)
  } catch (error) {
    log.error(`Failed to load language: ${lang}`, error)
    // Fall back to English if loading fails
    await i18n.changeLanguage('en')
    throw error
  }
}

export default i18n
