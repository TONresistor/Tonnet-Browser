/**
 * Settings Persistence Tests
 * Tests for file I/O, caching, and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDefaultSettings } from '@tests/helpers/factories'

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/mock/userData'
      return `/mock/${name}`
    }),
  },
}))

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

// Import after mocks are set up
import {
  loadSettings,
  saveSettings,
  getSetting,
  setSetting,
  resetSettings,
  getDefaultSettings,
  getDownloadPath,
  setDownloadPath,
} from '../index'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

describe('Settings Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset the internal cache by importing fresh
    vi.resetModules()
  })

  describe('loadSettings()', () => {
    it('returns cached settings on subsequent calls', async () => {
      // Re-import to get fresh module with cleared cache
      vi.resetModules()
      const { loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        general: { homepage: 'ton://cached' },
      }))

      const first = freshLoad()
      const second = freshLoad()

      // Should only read file once (cached)
      expect(readFileSync).toHaveBeenCalledTimes(1)
      expect(first).toBe(second) // Same reference
    })

    it('creates defaults when file does not exist', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(false)

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
      expect(writeFileSync).toHaveBeenCalled() // Saves defaults
    })

    it('merges partial settings with defaults', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        general: { homepage: 'http://custom.ton' },
        // Missing: network, storage, appearance, privacy, advanced
      }))

      const settings = freshLoad()

      // Custom value preserved
      expect(settings.general.homepage).toBe('http://custom.ton')
      // Defaults filled in
      expect(settings.network.proxyPort).toBe(8080)
      expect(settings.privacy.clearOnExit).toBe(true)
    })

    it('falls back to defaults on JSON parse error', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('{ invalid json }}}')

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
    })

    it('falls back to defaults on invalid settings structure', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        network: { proxyPort: 'not-a-number' }, // Invalid type
      }))

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.network.proxyPort).toBe(defaults.network.proxyPort)
    })

    it('falls back to defaults when file is an array', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('[]')

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
    })

    it('falls back to defaults when file is null', async () => {
      vi.resetModules()
      const { loadSettings: freshLoad, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue('null')

      const settings = freshLoad()
      const defaults = getDefaults()

      expect(settings.general.homepage).toBe(defaults.general.homepage)
    })
  })

  describe('saveSettings()', () => {
    it('creates directory if it does not exist', async () => {
      vi.resetModules()
      const { saveSettings: freshSave, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(false)

      freshSave(getDefaults())

      expect(mkdirSync).toHaveBeenCalledWith('/mock/userData', { recursive: true })
    })

    it('writes formatted JSON to file', async () => {
      vi.resetModules()
      const { saveSettings: freshSave, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      const defaults = getDefaults()

      freshSave(defaults)

      expect(writeFileSync).toHaveBeenCalledWith(
        '/mock/userData/app-settings.json',
        expect.stringContaining('"homepage"')
      )
      // Check it's formatted (indented)
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string
      expect(writtenContent).toContain('\n')
    })

    it('handles write errors gracefully', async () => {
      vi.resetModules()
      const { saveSettings: freshSave, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('Disk full')
      })

      // Should not throw
      expect(() => freshSave(getDefaults())).not.toThrow()
    })
  })

  describe('getSetting()', () => {
    it('returns specific category', async () => {
      vi.resetModules()
      const { getSetting: freshGet } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        network: { proxyPort: 9999 },
      }))

      const network = freshGet('network')

      expect(network.proxyPort).toBe(9999)
    })
  })

  describe('setSetting()', () => {
    it('merges partial updates into category', async () => {
      vi.resetModules()
      const { setSetting: freshSet, loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        network: { proxyPort: 8080, autoConnect: false },
      }))

      // Load first to populate cache
      freshLoad()

      // Update only proxyPort
      freshSet('network', { proxyPort: 9000 })

      // Check write was called with merged values
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.network.proxyPort).toBe(9000)
      expect(parsed.network.autoConnect).toBe(false) // Preserved
    })
  })

  describe('resetSettings()', () => {
    it('saves default settings to file', async () => {
      vi.resetModules()
      const { resetSettings: freshReset, getDefaultSettings: getDefaults } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)

      freshReset()

      const defaults = getDefaults()
      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.general.homepage).toBe(defaults.general.homepage)
      expect(parsed.network.proxyPort).toBe(defaults.network.proxyPort)
    })
  })

  describe('getDownloadPath() / setDownloadPath()', () => {
    it('getDownloadPath returns storage.downloadPath', async () => {
      vi.resetModules()
      const { getDownloadPath: freshGet } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        storage: { downloadPath: '/custom/path' },
      }))

      expect(freshGet()).toBe('/custom/path')
    })

    it('setDownloadPath updates storage.downloadPath', async () => {
      vi.resetModules()
      const { setDownloadPath: freshSet, loadSettings: freshLoad } = await import('../index')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}))

      freshLoad()
      freshSet('/new/path')

      const writtenContent = vi.mocked(writeFileSync).mock.calls[0][1] as string
      const parsed = JSON.parse(writtenContent)

      expect(parsed.storage.downloadPath).toBe('/new/path')
    })
  })

  describe('getDefaultSettings()', () => {
    it('returns complete settings structure', async () => {
      vi.resetModules()
      const { getDefaultSettings: getDefaults } = await import('../index')

      const defaults = getDefaults()

      // Check all categories exist
      expect(defaults).toHaveProperty('general')
      expect(defaults).toHaveProperty('network')
      expect(defaults).toHaveProperty('storage')
      expect(defaults).toHaveProperty('appearance')
      expect(defaults).toHaveProperty('privacy')
      expect(defaults).toHaveProperty('advanced')

      // Check critical defaults
      expect(defaults.general.homepage).toBe('ton://start')
      expect(defaults.network.proxyPort).toBe(8080)
      expect(defaults.network.autoConnect).toBe(false)
      expect(defaults.privacy.clearOnExit).toBe(true)
    })
  })
})
