import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import os from 'os'
import { isValidNavigationUrl, isValidBagId, isValidDownloadPath } from '../validation'

describe('isValidNavigationUrl', () => {
  it('accepts http://example.com', () => {
    const result = isValidNavigationUrl('http://example.com')
    expect(result.valid).toBe(true)
  })

  it('accepts https://example.com', () => {
    const result = isValidNavigationUrl('https://example.com')
    expect(result.valid).toBe(true)
  })

  it('accepts ton://start', () => {
    const result = isValidNavigationUrl('ton://start')
    expect(result.valid).toBe(true)
  })

  it('accepts ton://settings', () => {
    const result = isValidNavigationUrl('ton://settings')
    expect(result.valid).toBe(true)
  })

  it('accepts ton://storage', () => {
    const result = isValidNavigationUrl('ton://storage')
    expect(result.valid).toBe(true)
  })

  it('adds http:// automatically if no scheme (example.com -> http://example.com)', () => {
    const result = isValidNavigationUrl('example.com')
    expect(result.valid).toBe(true)
  })

  it('BLOCKS javascript:alert(1)', () => {
    const result = isValidNavigationUrl('javascript:alert(1)')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('BLOCKS data:text/html,...', () => {
    const result = isValidNavigationUrl('data:text/html,<script>alert(1)</script>')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('BLOCKS file:///etc/passwd', () => {
    const result = isValidNavigationUrl('file:///etc/passwd')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('file:')
  })

  it('BLOCKS vbscript:...', () => {
    const result = isValidNavigationUrl('vbscript:msgbox("xss")')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('returns error for invalid URL', () => {
    const result = isValidNavigationUrl('not a valid url at all :::')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('isValidBagId', () => {
  it('accepts 64 hex characters (lowercase a-f, 0-9)', () => {
    const validBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    expect(isValidBagId(validBagId)).toBe(true)
  })

  it('accepts 64 hex characters (uppercase A-F)', () => {
    const validBagId = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'
    expect(isValidBagId(validBagId)).toBe(true)
  })

  it('REJECTS less than 64 characters', () => {
    const shortBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
    expect(isValidBagId(shortBagId)).toBe(false)
  })

  it('REJECTS more than 64 characters', () => {
    const longBagId = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2extra'
    expect(isValidBagId(longBagId)).toBe(false)
  })

  it('REJECTS non-hex characters (g, z, etc)', () => {
    const invalidBagId = 'g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    expect(isValidBagId(invalidBagId)).toBe(false)

    const invalidBagId2 = 'z1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
    expect(isValidBagId(invalidBagId2)).toBe(false)
  })

  it('REJECTS empty string', () => {
    expect(isValidBagId('')).toBe(false)
  })

  it('REJECTS null/undefined (returns false, does not crash)', () => {
    expect(isValidBagId(null as unknown as string)).toBe(false)
    expect(isValidBagId(undefined as unknown as string)).toBe(false)
  })
})

describe('Windows path validation', () => {
  const originalPlatform = process.platform
  const originalSep = path.sep
  const originalSystemRoot = process.env.SystemRoot
  const originalWindir = process.env.windir
  const originalUserProfile = process.env.USERPROFILE
  const originalAppData = process.env.APPDATA
  const originalLocalAppData = process.env.LOCALAPPDATA

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true })
    // Redirect path methods to their win32 equivalents so Windows paths are
    // parsed correctly when running tests on Linux/macOS CI
    path.sep = '\\'
    vi.spyOn(path, 'isAbsolute').mockImplementation(path.win32.isAbsolute)
    vi.spyOn(path, 'normalize').mockImplementation(path.win32.normalize)
    vi.spyOn(path, 'parse').mockImplementation(path.win32.parse as typeof path.parse)
    vi.spyOn(path, 'join').mockImplementation(path.win32.join)
    process.env.SystemRoot = 'C:\\Windows'
    process.env.windir = 'C:\\Windows'
    process.env.USERPROFILE = 'C:\\Users\\TestUser'
    process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming'
    process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local'
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true })
    path.sep = originalSep
    process.env.SystemRoot = originalSystemRoot
    process.env.windir = originalWindir
    process.env.USERPROFILE = originalUserProfile
    process.env.APPDATA = originalAppData
    process.env.LOCALAPPDATA = originalLocalAppData
    vi.restoreAllMocks()
  })

  it('BLOCKS C:\\Windows\\System32', () => {
    const result = isValidDownloadPath('C:\\Windows\\System32')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS C:\\Program Files\\SomeApp', () => {
    const result = isValidDownloadPath('C:\\Program Files\\SomeApp')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS C:\\ProgramData\\SomeService', () => {
    const result = isValidDownloadPath('C:\\ProgramData\\SomeService')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS case-insensitive variant c:\\windows\\system32', () => {
    const result = isValidDownloadPath('c:\\windows\\system32')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('allows C:\\Users\\TestUser\\Downloads', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\TestUser')
    const result = isValidDownloadPath('C:\\Users\\TestUser\\Downloads')
    expect(result.valid).toBe(true)
  })

  it('allows path under APPDATA', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\TestUser')
    const result = isValidDownloadPath('C:\\Users\\TestUser\\AppData\\Roaming\\MyApp')
    expect(result.valid).toBe(true)
  })
})

describe('macOS path validation', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true })
    vi.restoreAllMocks()
  })

  it('BLOCKS /System/Library', () => {
    const result = isValidDownloadPath('/System/Library')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS /Library/Application Support', () => {
    const result = isValidDownloadPath('/Library/Application Support')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS /Applications', () => {
    const result = isValidDownloadPath('/Applications')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS /Applications/SomeApp.app', () => {
    const result = isValidDownloadPath('/Applications/SomeApp.app')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('BLOCKS /private/etc', () => {
    const result = isValidDownloadPath('/private/etc')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('System directories are not allowed')
  })

  it('allows /Users/testuser/Downloads', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser')
    const result = isValidDownloadPath('/Users/testuser/Downloads')
    expect(result.valid).toBe(true)
  })

  it('allows /tmp/mydownloads', () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser')
    const result = isValidDownloadPath('/tmp/mydownloads')
    expect(result.valid).toBe(true)
  })
})
