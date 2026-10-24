import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockApp = vi.hoisted(() => ({
  isPackaged: true,
  getVersion: () => '2.7.1',
  setPath: vi.fn(),
  commandLine: { appendSwitch: vi.fn() },
}))
vi.mock('electron', () => ({ app: mockApp }))
import { preparePackageSmoke } from '../package-smoke'

let profile: string
let originalArgs: string[]
beforeEach(() => {
  vi.stubEnv('CI', '')
  originalArgs = process.argv
  profile = realpathSync(mkdtempSync(join(tmpdir(), 'tonnet-smoke-guard-')))
  writeFileSync(join(profile, '.tonnet-package-smoke'), '')
  mockApp.isPackaged = true
  mockApp.setPath.mockClear()
  mockApp.commandLine.appendSwitch.mockClear()
  process.argv = [
    'app',
    `--tonnet-package-smoke=${profile}`,
    '--tonnet-package-smoke-phase=live',
    `--tonnet-package-smoke-report=${join(profile, 'write.json')}`,
    '--tonnet-package-smoke-version=2.7.1',
    '--tonnet-package-smoke-url=http://manifesto.ton/',
  ]
})
afterEach(() => {
  vi.unstubAllEnvs()
  process.argv = originalArgs
  rmSync(profile, { recursive: true, force: true })
})

describe('packaged smoke isolation', () => {
  it('does not change normal launch paths', () => {
    process.argv = ['app']
    expect(preparePackageSmoke()).toBeNull()
    expect(mockApp.setPath).not.toHaveBeenCalled()
    expect(mockApp.commandLine.appendSwitch).not.toHaveBeenCalled()
  })
  it('binds user data, Chromium storage and logs to the disposable profile', () => {
    expect(preparePackageSmoke()?.profile).toBe(profile)
    expect(mockApp.setPath).toHaveBeenCalledWith('userData', profile)
    expect(mockApp.setPath).toHaveBeenCalledWith('sessionData', profile)
    expect(mockApp.setPath).toHaveBeenCalledWith('logs', join(profile, 'logs'))
    if (process.platform === 'darwin')
      expect(mockApp.commandLine.appendSwitch).toHaveBeenCalledWith('use-mock-keychain')
  })
  it('refuses a profile without the disposable marker before setting any paths', () => {
    rmSync(join(profile, '.tonnet-package-smoke'))
    expect(() => preparePackageSmoke()).toThrow('marker missing')
    expect(mockApp.setPath).not.toHaveBeenCalled()
  })
  it.each([
    ['--tonnet-package-smoke-url=', 'https://example.com/', 'manifesto.ton'],
    ['--tonnet-package-smoke-report=', join(tmpdir(), 'outside.json'), 'inside'],
    ['--tonnet-package-smoke-phase=', 'other', 'phase'],
    ['--tonnet-package-smoke-version=', '0.0.0', 'version'],
  ])('refuses invalid invocation %s', (prefix, value, error) => {
    process.argv = process.argv.map((argument) => (argument.startsWith(prefix) ? prefix + value : argument))
    expect(() => preparePackageSmoke()).toThrow(error)
    expect(mockApp.setPath).not.toHaveBeenCalled()
  })
  it('allows visible mode only when explicitly requested locally', () => {
    expect(preparePackageSmoke()?.visible).toBe(false)
    process.argv.push('--tonnet-package-smoke-visible')
    expect(preparePackageSmoke()?.visible).toBe(true)
  })
  it('keeps CI invisible even when the visible flag is passed', () => {
    vi.stubEnv('CI', 'true')
    process.argv.push('--tonnet-package-smoke-visible')
    expect(preparePackageSmoke()?.visible).toBe(false)
  })
  it('refuses source Electron as a substitute for the package', () => {
    mockApp.isPackaged = false
    expect(() => preparePackageSmoke()).toThrow('packaged application')
    expect(mockApp.setPath).not.toHaveBeenCalled()
  })
})
