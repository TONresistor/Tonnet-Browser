import { describe, expect, it } from 'vitest'
import de from '@/locales/de/wallet.json'
import en from '@/locales/en/wallet.json'
import es from '@/locales/es/wallet.json'
import fr from '@/locales/fr/wallet.json'
import id from '@/locales/id/wallet.json'
import ko from '@/locales/ko/wallet.json'
import pt from '@/locales/pt/wallet.json'
import ru from '@/locales/ru/wallet.json'
import th from '@/locales/th/wallet.json'
import zh from '@/locales/zh/wallet.json'

describe('wallet word-count locales', () => {
  it('renders the selected mnemonic length in every backup translation', () => {
    for (const locale of [de, en, es, fr, id, ko, pt, ru, th, zh]) {
      expect(locale.backup.warning).toContain('{{count}}')
      expect(locale.backup.yourPhrase).toContain('{{count}}')
      expect(locale.backup.acknowledgement).not.toMatch(/\b(?:12|24)\b/)
    }
  })
})
