import { describe, it, expect } from 'vitest'
import { isValidSettingsObject, validateSettings, validateCategoryValues, getDefaultSettingsBase } from '../validation'

describe('isValidSettingsObject', () => {
  describe('valid inputs', () => {
    it('accepts an empty object', () => {
      expect(isValidSettingsObject({})).toBe(true)
    })

    it('accepts an object with valid categories', () => {
      const validSettings = {
        general: { homepage: 'ton://start' },
        network: { proxyPort: 8080 },
        storage: { downloadPath: '/tmp/storage' },
        appearance: { defaultZoom: 100 },
        privacy: { clearOnExit: true },
        advanced: { proxyVerbosity: 2 },
      }
      expect(isValidSettingsObject(validSettings)).toBe(true)
    })

    it('accepts partial settings with only some categories', () => {
      expect(isValidSettingsObject({ general: { homepage: 'ton://test' } })).toBe(true)
      expect(isValidSettingsObject({ network: { proxyPort: 9000 } })).toBe(true)
      expect(isValidSettingsObject({ privacy: { clearOnExit: false } })).toBe(true)
    })

    it('accepts empty category objects', () => {
      expect(isValidSettingsObject({ general: {}, network: {} })).toBe(true)
    })
  })

  describe('invalid inputs - non-objects', () => {
    it('rejects null', () => {
      expect(isValidSettingsObject(null)).toBe(false)
    })

    it('rejects arrays', () => {
      expect(isValidSettingsObject([])).toBe(false)
      expect(isValidSettingsObject([{ general: {} }])).toBe(false)
    })

    it('rejects primitives', () => {
      expect(isValidSettingsObject('string')).toBe(false)
      expect(isValidSettingsObject(123)).toBe(false)
      expect(isValidSettingsObject(true)).toBe(false)
      expect(isValidSettingsObject(undefined)).toBe(false)
    })
  })

  describe('invalid inputs - category format', () => {
    it('rejects if a category is not an object', () => {
      expect(isValidSettingsObject({ general: 'not an object' })).toBe(false)
      expect(isValidSettingsObject({ network: 123 })).toBe(false)
      expect(isValidSettingsObject({ storage: true })).toBe(false)
    })

    it('rejects if a category is null', () => {
      expect(isValidSettingsObject({ general: null })).toBe(false)
      expect(isValidSettingsObject({ network: null })).toBe(false)
    })

    it('rejects if a category is an array', () => {
      expect(isValidSettingsObject({ general: [] })).toBe(false)
      expect(isValidSettingsObject({ network: [8080] })).toBe(false)
    })
  })

  describe('field type validation', () => {
    describe('network settings', () => {
      it('rejects if proxyPort is not a number', () => {
        expect(isValidSettingsObject({ network: { proxyPort: '8080' } })).toBe(false)
        expect(isValidSettingsObject({ network: { proxyPort: true } })).toBe(false)
        expect(isValidSettingsObject({ network: { proxyPort: null } })).toBe(false)
      })

      it('accepts valid proxyPort number', () => {
        expect(isValidSettingsObject({ network: { proxyPort: 8080 } })).toBe(true)
        expect(isValidSettingsObject({ network: { proxyPort: 1024 } })).toBe(true)
      })

      it('rejects proxyPort out of valid range', () => {
        // Port 0 and values below 1024 are not valid listen ports
        expect(isValidSettingsObject({ network: { proxyPort: 0 } })).toBe(false)
        expect(isValidSettingsObject({ network: { proxyPort: 1023 } })).toBe(false)
        // Port > 65535 exceeds TCP range
        expect(isValidSettingsObject({ network: { proxyPort: 99999 } })).toBe(false)
      })

      it('rejects if storagePort is not a number', () => {
        expect(isValidSettingsObject({ network: { storagePort: '5555' } })).toBe(false)
      })

      it('accepts valid storagePort number', () => {
        expect(isValidSettingsObject({ network: { storagePort: 5555 } })).toBe(true)
      })

      it('rejects storagePort out of valid range', () => {
        expect(isValidSettingsObject({ network: { storagePort: 0 } })).toBe(false)
        expect(isValidSettingsObject({ network: { storagePort: 65536 } })).toBe(false)
      })

      it('rejects if autoConnect is not a boolean', () => {
        expect(isValidSettingsObject({ network: { autoConnect: 'true' } })).toBe(false)
        expect(isValidSettingsObject({ network: { autoConnect: 1 } })).toBe(false)
      })

      it('accepts valid autoConnect boolean', () => {
        expect(isValidSettingsObject({ network: { autoConnect: true } })).toBe(true)
        expect(isValidSettingsObject({ network: { autoConnect: false } })).toBe(true)
      })

      it('rejects if rotateInterval is not a string', () => {
        expect(isValidSettingsObject({ network: { rotateInterval: 123 } })).toBe(false)
        expect(isValidSettingsObject({ network: { rotateInterval: true } })).toBe(false)
      })

      it('rejects invalid rotateInterval format', () => {
        expect(isValidSettingsObject({ network: { rotateInterval: 'invalid' } })).toBe(false)
        expect(isValidSettingsObject({ network: { rotateInterval: '10' } })).toBe(false)
        expect(isValidSettingsObject({ network: { rotateInterval: 'm10' } })).toBe(false)
        expect(isValidSettingsObject({ network: { rotateInterval: '' } })).toBe(false)
      })

      it('accepts valid rotateInterval format', () => {
        expect(isValidSettingsObject({ network: { rotateInterval: '10m' } })).toBe(true)
        expect(isValidSettingsObject({ network: { rotateInterval: '5s' } })).toBe(true)
        expect(isValidSettingsObject({ network: { rotateInterval: '1h' } })).toBe(true)
        expect(isValidSettingsObject({ network: { rotateInterval: '30m' } })).toBe(true)
      })
    })

    describe('privacy settings', () => {
      it('rejects if clearOnExit is not a boolean', () => {
        expect(isValidSettingsObject({ privacy: { clearOnExit: 'true' } })).toBe(false)
        expect(isValidSettingsObject({ privacy: { clearOnExit: 1 } })).toBe(false)
      })

      it('accepts valid clearOnExit boolean', () => {
        expect(isValidSettingsObject({ privacy: { clearOnExit: true } })).toBe(true)
        expect(isValidSettingsObject({ privacy: { clearOnExit: false } })).toBe(true)
      })
    })

    describe('appearance settings', () => {
      it('rejects if defaultZoom is not a number', () => {
        expect(isValidSettingsObject({ appearance: { defaultZoom: '100' } })).toBe(false)
        expect(isValidSettingsObject({ appearance: { defaultZoom: true } })).toBe(false)
      })

      it('accepts valid defaultZoom number', () => {
        expect(isValidSettingsObject({ appearance: { defaultZoom: 100 } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { defaultZoom: 150 } })).toBe(true)
      })

      it('accepts built-in theme names', () => {
        expect(isValidSettingsObject({ appearance: { theme: 'resistance-dog' } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { theme: 'utya-duck' } })).toBe(true)
      })

      it('accepts legacy theme names for migration compatibility', () => {
        // Old names still accepted — migration happens in loadSettings
        expect(isValidSettingsObject({ appearance: { theme: 'midnight-blue' } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { theme: 'canard-yellow' } })).toBe(true)
      })

      it('accepts custom theme IDs with custom: prefix', () => {
        expect(isValidSettingsObject({ appearance: { theme: 'custom:myTheme' } })).toBe(true)
        expect(isValidSettingsObject({ appearance: { theme: 'custom:dark-variant' } })).toBe(true)
      })

      it('rejects invalid theme names', () => {
        expect(isValidSettingsObject({ appearance: { theme: 'invalid-theme' } })).toBe(false)
        expect(isValidSettingsObject({ appearance: { theme: '' } })).toBe(false)
        expect(isValidSettingsObject({ appearance: { theme: 'my-theme' } })).toBe(false)
      })
    })
  })

  describe('unknown categories', () => {
    it('ignores unknown categories (stripped/logged, object still valid)', () => {
      // Unknown categories are not a security risk — they are stripped or ignored
      expect(isValidSettingsObject({ unknownCategory: { foo: 'bar' } })).toBe(true)
    })
  })
})

describe('validateSettings', () => {
  it('returns valid:true with defaults for an empty object', () => {
    const result = validateSettings({})
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.general.homepage).toBe('ton://start')
      expect(result.data.network.proxyPort).toBe(8080)
      expect(result.data.privacy.clearOnExit).toBe(true)
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

  describe('rotateInterval regex validation', () => {
    it('accepts valid duration strings', () => {
      expect(validateSettings({ network: { rotateInterval: '10m' } }).valid).toBe(true)
      expect(validateSettings({ network: { rotateInterval: '5s' } }).valid).toBe(true)
      expect(validateSettings({ network: { rotateInterval: '1h' } }).valid).toBe(true)
      expect(validateSettings({ network: { rotateInterval: '30m' } }).valid).toBe(true)
    })

    it('rejects invalid duration strings', () => {
      expect(validateSettings({ network: { rotateInterval: 'invalid' } }).valid).toBe(false)
      expect(validateSettings({ network: { rotateInterval: '10' } }).valid).toBe(false)
      expect(validateSettings({ network: { rotateInterval: 'm10' } }).valid).toBe(false)
      expect(validateSettings({ network: { rotateInterval: '' } }).valid).toBe(false)
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

    it('rejects out-of-range port value', () => {
      const result = validateCategoryValues('network', { proxyPort: 0 })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid rotateInterval format', () => {
      const result = validateCategoryValues('network', { rotateInterval: 'invalid' })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid theme in appearance', () => {
      const result = validateCategoryValues('appearance', { theme: 'invalid-theme' })
      expect(result.valid).toBe(false)
    })
  })
})

describe('getDefaultSettingsBase', () => {
  it('returns all required categories', () => {
    const defaults = getDefaultSettingsBase()

    expect(defaults).toHaveProperty('general')
    expect(defaults).toHaveProperty('network')
    expect(defaults).toHaveProperty('storage')
    expect(defaults).toHaveProperty('appearance')
    expect(defaults).toHaveProperty('privacy')
    expect(defaults).toHaveProperty('advanced')
  })

  describe('general settings defaults', () => {
    it('has correct homepage default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.general.homepage).toBe('ton://start')
    })

    it('has correct restoreTabs default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.general.restoreTabs).toBe(false)
    })
  })

  describe('network settings defaults', () => {
    it('has correct proxyPort default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.network.proxyPort).toBe(8080)
    })

    it('has correct storagePort default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.network.storagePort).toBe(5555)
    })

    it('has correct autoConnect default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.network.autoConnect).toBe(false)
    })

    it('has correct connectionTimeout default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.network.connectionTimeout).toBe(30)
    })

    it('has correct syncCheckInterval default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.network.syncCheckInterval).toBe(3000)
    })

    it('has correct rotateInterval default format', () => {
      const defaults = getDefaultSettingsBase()
      // Default must be a valid duration string (number + unit)
      expect(defaults.network.rotateInterval).toBe('10m')
      expect(validateSettings({ network: { rotateInterval: defaults.network.rotateInterval } }).valid).toBe(true)
    })
  })

  describe('storage settings defaults', () => {
    it('has a downloadPath', () => {
      const defaults = getDefaultSettingsBase()
      expect(typeof defaults.storage.downloadPath).toBe('string')
      expect(defaults.storage.downloadPath.length).toBeGreaterThan(0)
    })

    it('has correct pollingInterval default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.storage.pollingInterval).toBe(2000)
    })
  })

  describe('appearance settings defaults', () => {
    it('has correct defaultZoom default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.appearance.defaultZoom).toBe(100)
    })

    it('has correct zoomMin default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.appearance.zoomMin).toBe(30)
    })

    it('has correct zoomMax default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.appearance.zoomMax).toBe(300)
    })

    it('has correct showBookmarksBar default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.appearance.showBookmarksBar).toBe(true)
    })

    it('has correct showStatusBar default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.appearance.showStatusBar).toBe(true)
    })

    it('has a valid built-in theme as default', () => {
      const defaults = getDefaultSettingsBase()
      expect(validateSettings({ appearance: { theme: defaults.appearance.theme } }).valid).toBe(true)
    })
  })

  describe('privacy settings defaults', () => {
    it('has correct clearOnExit default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.privacy.clearOnExit).toBe(true)
    })
  })

  describe('advanced settings defaults', () => {
    it('has correct proxyVerbosity default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.advanced.proxyVerbosity).toBe(2)
    })

    it('has correct storageVerbosity default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.advanced.storageVerbosity).toBe(2)
    })

    it('has correct syncTestDomain default', () => {
      const defaults = getDefaultSettingsBase()
      expect(defaults.advanced.syncTestDomain).toBe('tonnet-sync-check.ton')
    })
  })

  it('returns valid settings according to isValidSettingsObject', () => {
    const defaults = getDefaultSettingsBase()
    expect(isValidSettingsObject(defaults)).toBe(true)
  })

  it('returns valid settings according to validateSettings (Zod)', () => {
    const defaults = getDefaultSettingsBase()
    expect(validateSettings(defaults).valid).toBe(true)
  })
})
