import { z } from 'zod'
import {
  AdvancedSettingsSchema,
  AppearanceSettingsSchema,
  AppSettingsSchema,
  BridgeSettingsSchema,
  CocoonSettingsSchema,
  ContentFilteringSettingsSchema,
  GeneralSettingsSchema,
  MessengerSettingsSchema,
  NetworkSettingsSchema,
  PrivacySettingsSchema,
  StorageSettingsSchema,
  WalletSettingsSchema,
} from '../schemas'
import { defineEvent, defineRequest } from './definition'
import { SETTINGS_CHANNELS } from './channels'

export const SettingsCategorySchema = z.enum([
  'general',
  'network',
  'storage',
  'appearance',
  'privacy',
  'contentFiltering',
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
  ContentFilteringSettingsSchema.strict(),
  AdvancedSettingsSchema.strict(),
  WalletSettingsSchema.strict(),
  BridgeSettingsSchema.strict(),
  CocoonSettingsSchema.strict(),
  MessengerSettingsSchema.strict(),
])
const SuccessSchema = z.object({ success: z.literal(true) })
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
export const settingsResetContract = defineRequest({
  ...base,
  channel: SETTINGS_CHANNELS.reset,
  input: z.tuple([]),
  output: SuccessSchema,
  errors: ['SETTINGS_RESET_FAILED', 'RUNTIME_APPLY_FAILED'],
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
      z.object({ reset: z.literal(true) }),
      z.object({ category: SettingsCategorySchema, values: z.record(z.string(), z.unknown()) }),
    ]),
  ]),
  redaction: 'sensitive',
})
export const SETTINGS_REQUEST_CONTRACTS = [
  settingsGetAllContract,
  settingsGetContract,
  settingsSetContract,
  settingsResetContract,
  clearBrowsingDataContract,
] as const
export type SettingsCategory = z.infer<typeof SettingsCategorySchema>
