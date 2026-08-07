import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_KEYS } from '@shared/theme-tokens'
import de from '@/locales/de/settings.json'
import en from '@/locales/en/settings.json'
import es from '@/locales/es/settings.json'
import fr from '@/locales/fr/settings.json'
import id from '@/locales/id/settings.json'
import ko from '@/locales/ko/settings.json'
import pt from '@/locales/pt/settings.json'
import ru from '@/locales/ru/settings.json'
import th from '@/locales/th/settings.json'
import zh from '@/locales/zh/settings.json'

const COLOR_KEYS = THEME_TOKEN_KEYS

const LOCALES = { en, fr, de, es, id, ko, pt, ru, th, zh } as const

describe('theme color help translations', () => {
  it.each(Object.entries(LOCALES))('%s documents every editable token', (locale, settings) => {
    const colors = settings.themeEditor.colors as Record<string, string>

    for (const key of COLOR_KEYS) {
      expect(colors[key], `${locale}.${key}`).toBeTruthy()
      expect(colors[`${key}Desc`], `${locale}.${key}Desc`).toBeTruthy()
    }
  })

  it('does not fall back to English help in translated locales', () => {
    const english = en.themeEditor.colors as Record<string, string>

    for (const [locale, settings] of Object.entries(LOCALES)) {
      if (locale === 'en') continue
      const colors = settings.themeEditor.colors as Record<string, string>
      for (const key of COLOR_KEYS) {
        expect(colors[`${key}Desc`], `${locale}.${key}Desc`).not.toBe(english[`${key}Desc`])
      }
    }
  })
})
