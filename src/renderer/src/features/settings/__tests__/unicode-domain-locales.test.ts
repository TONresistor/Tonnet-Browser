import { describe, expect, it } from 'vitest'
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

const LOCALES = { de, en, es, fr, id, ko, pt, ru, th, zh }

describe('Unicode-domain setting translations', () => {
  it.each(Object.entries(LOCALES))('%s provides the experimental feature labels', (_locale, settings) => {
    expect(settings.advanced.experimental.title).toBeTruthy()
    expect(settings.advanced.experimental.unicodeDomains).toBeTruthy()
    expect(settings.advanced.experimental.unicodeDomainsDesc).toBeTruthy()
    expect(settings.advanced.experimental.tonConnect).toBeTruthy()
    expect(settings.advanced.experimental.tonConnectDesc).toBeTruthy()
  })
})
