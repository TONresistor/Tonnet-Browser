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
  ns: ['common', 'landing', 'browser', 'settings', 'storage', 'pages', 'wallet', 'dns'],
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
    // Dynamic imports for the requested language
    const [common, landing, browser, settings, storage, pages, wallet, dns] = await Promise.all([
      import(`./locales/${lang}/common.json`),
      import(`./locales/${lang}/landing.json`),
      import(`./locales/${lang}/browser.json`),
      import(`./locales/${lang}/settings.json`),
      import(`./locales/${lang}/storage.json`),
      import(`./locales/${lang}/pages.json`),
      import(`./locales/${lang}/wallet.json`).catch(() => ({ default: {} })),
      import(`./locales/${lang}/dns.json`).catch(() => ({ default: {} })),
    ])

    // Add resources to i18next
    i18n.addResourceBundle(lang, 'common', common.default)
    i18n.addResourceBundle(lang, 'landing', landing.default)
    i18n.addResourceBundle(lang, 'browser', browser.default)
    i18n.addResourceBundle(lang, 'settings', settings.default)
    i18n.addResourceBundle(lang, 'storage', storage.default)
    i18n.addResourceBundle(lang, 'pages', pages.default)
    i18n.addResourceBundle(lang, 'wallet', wallet.default)
    i18n.addResourceBundle(lang, 'dns', dns.default)

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

/**
 * Check if a language is currently loaded
 * @param lang - Language code
 * @returns true if language is loaded
 */
export function isLanguageLoaded(lang: string): boolean {
  return loadedLanguages.has(lang)
}

/**
 * Get list of loaded languages
 * @returns Array of loaded language codes
 */
export function getLoadedLanguages(): string[] {
  return Array.from(loadedLanguages)
}

export default i18n
