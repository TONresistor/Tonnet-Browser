import { describe, expect, it } from 'vitest'
import {
  settingsChangedContract,
  settingsDiagnosticsEnableContract,
  settingsDiagnosticsGetContract,
  settingsDiagnosticsCopyContract,
  settingsGetContract,
  settingsSetContract,
  SettingsCategorySchema,
} from '../settings'

describe('settings IPC contracts', () => {
  it('uses the canonical category allowlist at the boundary', () => {
    expect(SettingsCategorySchema.parse('wallet')).toBe('wallet')
    expect(() => SettingsCategorySchema.parse('developerSecrets')).toThrow()
  })
  it('rejects non-object updates and validates change events', () => {
    expect(() => settingsSetContract.input.parse(['wallet', null])).toThrow()
    expect(
      settingsChangedContract.payload.parse([{ category: 'privacy', values: { clearOnExit: true } }])
    ).toHaveLength(1)
    expect(() => settingsChangedContract.payload.parse([{ category: 'invalid', values: {} }])).toThrow()
  })

  it('preserves the wallet category shape in settings:get output', () => {
    const wallet = {
      paymentMode: 'off' as const,
      notificationStyle: 'addressbar' as const,
      limits: { perRequest: '0', perDay: '0', perSitePerMonth: '0' },
      sitePolicies: [],
      autoPayDomains: [],
      autoLockMinutes: 5,
      indexerEnabled: true,
      indexerEndpoint: 'https://toncenter.com/api/v3',
      indexerApiKey: '',
    }

    expect(settingsGetContract.output.parse(wallet)).toEqual(wallet)
  })

  it('keeps diagnostics temporary and exposes only status metadata', () => {
    expect(settingsDiagnosticsGetContract.output.parse({ enabled: false, until: null })).toEqual({
      enabled: false,
      until: null,
    })
    expect(settingsDiagnosticsEnableContract.output.parse({ enabled: true, until: Date.now() + 1_000 }).enabled).toBe(
      true
    )
    expect(() => settingsDiagnosticsEnableContract.input.parse([60_000])).toThrow()
    expect(settingsDiagnosticsCopyContract.output.parse({ success: true })).toEqual({ success: true })
  })
})
