import { describe, it, expect } from 'vitest'
import { validateSettings, validateCategoryValues } from '../validation'
import { WalletSettingsSchema, WalletSettingsPartialSchema } from '../../../shared/schemas'

describe('validateSettings', () => {
  it('returns valid:true with defaults for an empty object', () => {
    const result = validateSettings({})
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.general.homepage).toBe('ton://start')
      expect(result.data.network.proxyPort).toBe(8080)
      expect(result.data.privacy.clearOnExit).toBe(true)
      expect(result.data.wallet.paymentMode).toBe('off')
      expect(result.data.messenger.autostart).toBe(false)
      expect(result.data.advanced.displayUnicodeDomains).toBe(false)
      expect(result.data.advanced.tonConnectEnabled).toBe(false)
    }
  })

  it('returns valid:true and fills field-level defaults for partial category', () => {
    const result = validateSettings({ network: { autoConnect: true } })
    expect(result.valid).toBe(true)
    if (result.valid) {
      // autoConnect was provided
      expect(result.data.network.autoConnect).toBe(true)
      // proxyPort gets its default since network object was present
      expect(result.data.network.proxyPort).toBe(8080)
      expect(result.data.network.storagePort).toBe(5555)
    }
  })

  it('returns valid:false for null', () => {
    const result = validateSettings(null)
    expect(result.valid).toBe(false)
  })

  it('returns valid:false for arrays', () => {
    const result = validateSettings([])
    expect(result.valid).toBe(false)
  })

  it('returns valid:false for primitives', () => {
    expect(validateSettings('string').valid).toBe(false)
    expect(validateSettings(123).valid).toBe(false)
  })

  describe('range validation — proxyPort', () => {
    it('rejects proxyPort: 0 (below minimum 1024)', () => {
      const result = validateSettings({ network: { proxyPort: 0 } })
      expect(result.valid).toBe(false)
    })

    it('rejects proxyPort: 99999 (above maximum 65535)', () => {
      const result = validateSettings({ network: { proxyPort: 99999 } })
      expect(result.valid).toBe(false)
    })

    it('rejects proxyPort: 1023 (one below minimum)', () => {
      const result = validateSettings({ network: { proxyPort: 1023 } })
      expect(result.valid).toBe(false)
    })

    it('accepts proxyPort: 1024 (minimum boundary)', () => {
      const result = validateSettings({ network: { proxyPort: 1024 } })
      expect(result.valid).toBe(true)
    })

    it('accepts proxyPort: 65535 (maximum boundary)', () => {
      const result = validateSettings({ network: { proxyPort: 65535 } })
      expect(result.valid).toBe(true)
    })

    it('accepts proxyPort: 8080 (typical value)', () => {
      const result = validateSettings({ network: { proxyPort: 8080 } })
      expect(result.valid).toBe(true)
    })
  })

  describe('range validation — storagePort', () => {
    it('rejects storagePort: 0 (below minimum)', () => {
      const result = validateSettings({ network: { storagePort: 0 } })
      expect(result.valid).toBe(false)
    })

    it('rejects storagePort: 65536 (above maximum)', () => {
      const result = validateSettings({ network: { storagePort: 65536 } })
      expect(result.valid).toBe(false)
    })

    it('accepts storagePort: 5555 (typical value)', () => {
      const result = validateSettings({ network: { storagePort: 5555 } })
      expect(result.valid).toBe(true)
    })
  })

  describe('theme validation', () => {
    it('accepts built-in theme names', () => {
      expect(validateSettings({ appearance: { theme: 'resistance-dog' } }).valid).toBe(true)
      expect(validateSettings({ appearance: { theme: 'utya-duck' } }).valid).toBe(true)
    })

    it('accepts legacy theme names (migration)', () => {
      expect(validateSettings({ appearance: { theme: 'midnight-blue' } }).valid).toBe(true)
      expect(validateSettings({ appearance: { theme: 'canard-yellow' } }).valid).toBe(true)
    })

    it('accepts custom theme IDs with custom: prefix', () => {
      expect(validateSettings({ appearance: { theme: 'custom:myTheme' } }).valid).toBe(true)
      expect(validateSettings({ appearance: { theme: 'custom:dark-variant' } }).valid).toBe(true)
    })

    it('rejects invalid theme names', () => {
      expect(validateSettings({ appearance: { theme: 'invalid-theme' } }).valid).toBe(false)
      expect(validateSettings({ appearance: { theme: '' } }).valid).toBe(false)
      expect(validateSettings({ appearance: { theme: 'my-theme' } }).valid).toBe(false)
    })
  })

  it('includes error message on failure', () => {
    const result = validateSettings({ network: { proxyPort: 0 } })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(typeof result.error).toBe('string')
      expect(result.error.length).toBeGreaterThan(0)
    }
  })
})

describe('validateCategoryValues', () => {
  describe('valid inputs', () => {
    it('accepts empty object for any category', () => {
      expect(validateCategoryValues('general', {}).valid).toBe(true)
      expect(validateCategoryValues('network', {}).valid).toBe(true)
      expect(validateCategoryValues('privacy', {}).valid).toBe(true)
    })

    it('accepts partial update for network', () => {
      const result = validateCategoryValues('network', { proxyPort: 9000 })
      expect(result.valid).toBe(true)
    })

    it('accepts partial update for general', () => {
      const result = validateCategoryValues('general', { homepage: 'ton://custom' })
      expect(result.valid).toBe(true)
    })

    it('accepts partial update for appearance', () => {
      const result = validateCategoryValues('appearance', { theme: 'resistance-dog' })
      expect(result.valid).toBe(true)
    })

    it('accepts the Unicode-domain display preference', () => {
      const result = validateCategoryValues('advanced', { displayUnicodeDomains: true })
      expect(result.valid).toBe(true)
    })

    it('accepts the experimental TON Connect preference', () => {
      const result = validateCategoryValues('advanced', { tonConnectEnabled: true })
      expect(result.valid).toBe(true)
    })
  })

  describe('invalid inputs', () => {
    it('rejects unknown category', () => {
      // @ts-expect-error testing invalid input
      const result = validateCategoryValues('unknownCategory', {})
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.error).toContain('Unknown category')
      }
    })

    it('rejects invalid field type', () => {
      const result = validateCategoryValues('network', { proxyPort: 'not-a-number' })
      expect(result.valid).toBe(false)
    })

    it('rejects explicit undefined values', () => {
      expect(validateCategoryValues('network', { proxyPort: undefined }).valid).toBe(false)
    })

    it('rejects out-of-range port value', () => {
      const result = validateCategoryValues('network', { proxyPort: 0 })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid theme in appearance', () => {
      const result = validateCategoryValues('appearance', { theme: 'invalid-theme' })
      expect(result.valid).toBe(false)
    })

    it('rejects an invalid Unicode-domain display preference', () => {
      const result = validateCategoryValues('advanced', { displayUnicodeDomains: 'true' })
      expect(result.valid).toBe(false)
    })

    it('rejects an invalid experimental TON Connect preference', () => {
      const result = validateCategoryValues('advanced', { tonConnectEnabled: 'true' })
      expect(result.valid).toBe(false)
    })
  })
})

describe('WalletSettingsPartialSchema drift guard', () => {
  it('exposes exactly the same keys as the full wallet schema', () => {
    const full = Object.keys(WalletSettingsSchema.shape).sort()
    const partial = Object.keys(WalletSettingsPartialSchema.shape).sort()
    expect(partial).toEqual(full)
  })

  it('does not strip indexer fields on a partial wallet update', () => {
    const res = validateCategoryValues('wallet', {
      indexerEnabled: true,
      indexerEndpoint: 'https://toncenter.com/api/v3',
      indexerApiKey: 'secret',
    })
    expect(res.valid).toBe(true)
    if (res.valid) {
      expect(res.data).toEqual({
        indexerEnabled: true,
        indexerEndpoint: 'https://toncenter.com/api/v3',
        indexerApiKey: 'secret',
      })
    }
  })

  it('requires HTTPS for remote indexers but permits a local HTTP indexer', () => {
    expect(validateCategoryValues('wallet', { indexerEndpoint: 'http://indexer.example/api/v3' }).valid).toBe(false)
    expect(validateCategoryValues('wallet', { indexerEndpoint: 'http://localhost:8080/api/v3' }).valid).toBe(true)
  })
})
