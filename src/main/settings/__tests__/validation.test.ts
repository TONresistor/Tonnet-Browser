import { describe, it, expect } from 'vitest'
import { isValidSettingsObject, getDefaultSettingsBase } from '../validation'

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
        expect(isValidSettingsObject({ network: { proxyPort: 0 } })).toBe(true)
      })

      it('rejects if storagePort is not a number', () => {
        expect(isValidSettingsObject({ network: { storagePort: '5555' } })).toBe(false)
      })

      it('accepts valid storagePort number', () => {
        expect(isValidSettingsObject({ network: { storagePort: 5555 } })).toBe(true)
      })

      it('rejects if autoConnect is not a boolean', () => {
        expect(isValidSettingsObject({ network: { autoConnect: 'true' } })).toBe(false)
        expect(isValidSettingsObject({ network: { autoConnect: 1 } })).toBe(false)
      })

      it('accepts valid autoConnect boolean', () => {
        expect(isValidSettingsObject({ network: { autoConnect: true } })).toBe(true)
        expect(isValidSettingsObject({ network: { autoConnect: false } })).toBe(true)
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
    })
  })

  describe('unknown categories', () => {
    it('allows unknown categories but logs warning', () => {
      // Unknown categories are allowed (with warning) as long as they are objects
      expect(isValidSettingsObject({ unknownCategory: { foo: 'bar' } })).toBe(true)
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
})
