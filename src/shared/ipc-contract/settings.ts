import { z } from 'zod'
import {
  AdvancedSettingsSchema,
  AppearanceSettingsSchema,
  AppSettingsSchema,
  BridgeSettingsSchema,
  CocoonSettingsSchema,
  GeneralSettingsSchema,
  MessengerSettingsSchema,
  NetworkSettingsSchema,
  PrivacySettingsSchema,
  StorageSettingsSchema,
  WalletSettingsSchema,
  GeneralSettingsPartialSchema,
  NetworkSettingsPartialSchema,
  StorageSettingsPartialSchema,
  AppearanceSettingsPartialSchema,
  PrivacySettingsPartialSchema,
  AdvancedSettingsPartialSchema,
  WalletSettingsPartialSchema,
  BridgeSettingsPartialSchema,
  CocoonSettingsPartialSchema,
  MessengerSettingsPartialSchema,
  hasExplicitUndefined,
} from '../schemas'
import { defineEvent, defineRequest } from './definition'
import { SETTINGS_CHANNELS } from './channels'

export const SettingsCategorySchema = z.enum([
  'general',
  'network',
  'storage',
  'appearance',
  'privacy',
  'advanced',
  'wallet',
  'bridge',
  'cocoon',
  'messenger',
])

const SettingsCategoryValueSchema = z.union([
  GeneralSettingsSchema.strict(),
  NetworkSettingsSchema.strict(),
  StorageSettingsSchema.strict(),
  AppearanceSettingsSchema.strict(),
  PrivacySettingsSchema.strict(),
  AdvancedSettingsSchema.strict(),
  WalletSettingsSchema.strict(),
  BridgeSettingsSchema.strict(),
  CocoonSettingsSchema.strict(),
  MessengerSettingsSchema.strict(),
])
const SuccessSchema = z.object({ success: z.literal(true) })
export const SettingsPatchSchema = z
  .object({
    general: GeneralSettingsPartialSchema,
    network: NetworkSettingsPartialSchema,
    storage: StorageSettingsPartialSchema,
    appearance: AppearanceSettingsPartialSchema,
    privacy: PrivacySettingsPartialSchema,
    advanced: AdvancedSettingsPartialSchema,
    wallet: WalletSettingsPartialSchema,
    bridge: BridgeSettingsPartialSchema,
    cocoon: CocoonSettingsPartialSchema,
    messenger: MessengerSettingsPartialSchema,
  })
  .partial()
  .strict()
  .refine((patch) => !hasExplicitUndefined(patch), { message: 'Settings patch values must be defined' })
  .refine((patch) => Object.keys(patch).length > 0)
const base = {
  direction: 'request' as const,
  caller: 'main-renderer' as const,
  authorization: 'main-window' as const,
  rateLimit: { kind: 'none' as const },
  redaction: 'sensitive' as const,
}

export const settingsGetAllContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.getAll,
  input: z.tuple([]),
  output: AppSettingsSchema,
  errors: ['SETTINGS_READ_FAILED'],
})
export const settingsGetContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.get,
  input: z.tuple([SettingsCategorySchema]),
  output: SettingsCategoryValueSchema,
  errors: ['INVALID_SETTINGS_CATEGORY', 'SETTINGS_READ_FAILED'],
})
export const settingsSetContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.set,
  input: z.tuple([SettingsCategorySchema, z.record(z.string(), z.unknown())]),
  output: SuccessSchema,
  errors: ['INVALID_SETTINGS_CATEGORY', 'INVALID_SETTINGS_VALUES', 'SETTINGS_WRITE_FAILED', 'RUNTIME_APPLY_FAILED'],
})
export const settingsApplyContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.apply,
  input: z.tuple([SettingsPatchSchema]),
  output: AppSettingsSchema,
  errors: ['INVALID_SETTINGS_VALUES', 'SETTINGS_WRITE_FAILED', 'RUNTIME_APPLY_FAILED'],
})
export const settingsResetContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.reset,
  input: z.tuple([]),
  output: SuccessSchema.extend({ settings: AppSettingsSchema }),
  errors: ['SETTINGS_RESET_FAILED', 'RUNTIME_APPLY_FAILED'],
})
const DiagnosticStatusSchema = z.object({ enabled: z.boolean(), until: z.number().int().positive().nullable() })
export const settingsDiagnosticsGetContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.diagnosticsGet,
  input: z.tuple([]),
  output: DiagnosticStatusSchema,
  errors: ['DIAGNOSTICS_STATUS_FAILED'],
})
export const settingsDiagnosticsEnableContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.diagnosticsEnable,
  input: z.tuple([]),
  output: DiagnosticStatusSchema,
  errors: ['DIAGNOSTICS_ENABLE_FAILED'],
})
export const settingsDiagnosticsDisableContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.diagnosticsDisable,
  input: z.tuple([]),
  output: DiagnosticStatusSchema,
  errors: ['DIAGNOSTICS_DISABLE_FAILED'],
})
export const settingsDiagnosticsCopyContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.diagnosticsCopy,
  input: z.tuple([]),
  output: SuccessSchema,
  errors: ['DIAGNOSTICS_COPY_FAILED'],
})
export const clearBrowsingDataContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.clearBrowsingData,
  input: z.tuple([]),
  output: SuccessSchema,
  errors: ['BROWSING_DATA_CLEAR_FAILED'],
})
export const settingsChangedContract = defineEvent({
  channel: SETTINGS_CHANNELS.changed,
  direction: 'event',
  recipient: 'main-renderer',
  payload: z.tuple([
    z.union([
      z.object({ reset: z.literal(true), settings: AppSettingsSchema }),
      z.object({
        category: SettingsCategorySchema,
        values: z.record(z.string(), z.unknown()),
        settings: AppSettingsSchema,
      }),
    ]),
  ]),
  redaction: 'sensitive',
})
export const SETTINGS_REQUEST_CONTRACTS = [
  settingsGetAllContract,
  settingsGetContract,
  settingsSetContract,
  settingsApplyContract,
  settingsResetContract,
  settingsDiagnosticsGetContract,
  settingsDiagnosticsEnableContract,
  settingsDiagnosticsDisableContract,
  settingsDiagnosticsCopyContract,
  clearBrowsingDataContract,
] as const
export type SettingsCategory = z.infer<typeof SettingsCategorySchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>
