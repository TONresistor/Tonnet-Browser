/**
 * Zod schemas for settings validation.
 * Used by both main and renderer processes.
 */

import { z } from 'zod'

// --- Zod Schemas ---

export const GeneralSettingsSchema = z.object({
  homepage: z.string().default('ton://start'),
  resolveEth: z.boolean().default(false),
  ethRpc: z.union([z.literal(''), z.string().url()]).default(''),
  resolveSol: z.boolean().default(false),
  solRpc: z.union([z.literal(''), z.string().url()]).default(''),
})

export const NetworkSettingsSchema = z.object({
  proxyPort: z.number().int().min(1024).max(65535).default(8080),
  storagePort: z.number().int().min(1024).max(65535).default(5555),
  wsPort: z.number().int().min(1024).max(65535).default(8081),
  autoConnect: z.boolean().default(false),
  connectionTimeout: z.number().min(5).max(120).default(30),
  syncCheckInterval: z.number().min(500).max(60000).default(3000),
  anonymousMode: z.boolean().default(false),
  tunnelMode: z.enum(['standard', 'maximum']).default('standard'),
})

export const StorageSettingsSchema = z.object({
  downloadPath: z.string().default(''),
  pollingInterval: z.number().min(500).max(30000).default(2000),
  seedingEnabled: z.boolean().default(false),
  downloadSpeedLimit: z.number().min(0).max(104857600).default(0),
  uploadSpeedLimit: z.number().min(0).max(104857600).default(0),
})

// Theme: built-in names OR custom:* prefix
const BuiltInThemeSchema = z.enum(['resistance-dog', 'utya-duck'])
const LegacyThemeSchema = z.enum(['midnight-blue', 'canard-yellow'])
const CustomThemeIdSchema = z.string().startsWith('custom:')
export const ThemeTypeSchema = z.union([BuiltInThemeSchema, LegacyThemeSchema, CustomThemeIdSchema])

export const ThemeColorsSchema = z.object({
  background: z.string(),
  backgroundSecondary: z.string(),
  foreground: z.string(),
  card: z.string(),
  cardForeground: z.string(),
  primary: z.string(),
  primaryForeground: z.string(),
  secondary: z.string(),
  secondaryForeground: z.string(),
  accent: z.string(),
  accentForeground: z.string(),
  muted: z.string(),
  mutedForeground: z.string(),
  destructive: z.string(),
  destructiveForeground: z.string(),
  success: z.string(),
  successForeground: z.string(),
  warning: z.string(),
  warningForeground: z.string(),
  info: z.string(),
  infoForeground: z.string(),
  border: z.string(),
  input: z.string(),
  ring: z.string(),
})

export const CustomThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  colors: ThemeColorsSchema,
  isDark: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const AppearanceSettingsSchema = z.object({
  theme: ThemeTypeSchema.default('resistance-dog'),
  customThemes: z.array(CustomThemeSchema).default([]),
  language: z.string().default('en'),
  defaultZoom: z.number().min(25).max(500).default(100),
  zoomMin: z.number().min(10).max(100).default(30),
  zoomMax: z.number().min(100).max(500).default(300),
  showBookmarksBar: z.boolean().default(true),
  showStatusBar: z.boolean().default(true),
  tabOrientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  sidebarWidth: z.number().min(64).max(400).default(240),
})

export const PrivacySettingsSchema = z.object({
  clearOnExit: z.boolean().default(true),
  disableCache: z.boolean().default(false),
  firstPartyIsolation: z.boolean().default(true),
  cookieAutoDelete: z.boolean().default(true),
  cookieAutoDeleteMinutes: z.number().min(1).max(1440).default(30),
  historyMode: z.enum(['memory', 'persistent']).default('memory'),
  historyMaxEntries: z.number().min(100).max(100000).default(100),
})

export const ContentFilteringSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  blockAds: z.boolean().default(true),
  blockTrackers: z.boolean().default(true),
  blockMiners: z.boolean().default(true),
  blockMalware: z.boolean().default(true),
  blockAnnoyances: z.boolean().default(true),
  whitelistedDomains: z.array(z.string()).default([]),
})

export const AdvancedSettingsSchema = z.object({
  proxyVerbosity: z.number().min(0).max(5).default(2),
  storageVerbosity: z.number().min(0).max(5).default(2),
  syncTestDomain: z.string().default('tonnet-sync-check.ton'),
})

// --- Wallet Zod schemas ---

const SpendingLimitsSchema = z.object({
  perRequest: z.string().default('0'),
  perDay: z.string().default('0'),
  perSitePerMonth: z.string().default('0'),
})

const SitePolicySchema = z.object({
  domain: z.string(),
  mode: z.enum(['off', 'manual', 'auto']),
  customLimits: SpendingLimitsSchema.optional(),
  totalSpent: z.string().default('0'),
  lastPayment: z.number().optional(),
})

export const WalletSettingsSchema = z.object({
  paymentMode: z.enum(['off', 'manual', 'auto']).default('manual'),
  notificationStyle: z.enum(['popup', 'addressbar']).default('popup'),
  limits: SpendingLimitsSchema.default({
    perRequest: '0',
    perDay: '0',
    perSitePerMonth: '0',
  }),
  sitePolicies: z.array(SitePolicySchema).default([]),
  autoPayDomains: z.array(z.string()).default([]),
  autoLockMinutes: z.number().min(0).max(1440).default(5),
})

export const WalletSettingsPartialSchema = z
  .object({
    paymentMode: z.enum(['off', 'manual', 'auto']),
    notificationStyle: z.enum(['popup', 'addressbar']),
    limits: SpendingLimitsSchema.partial(),
    sitePolicies: z.array(SitePolicySchema),
    autoPayDomains: z.array(z.string()),
    autoLockMinutes: z.number().min(0).max(1440),
  })
  .partial()

// Bridge permission system
const BridgePermissionSchema = z.object({
  domain: z.string(),
  scope: z.enum(['blockchain', 'p2p', 'write']),
  decision: z.enum(['granted', 'denied', 'session']),
  grantedAt: z.number(),
})

export const BridgeSettingsSchema = z.object({
  permissions: z.array(BridgePermissionSchema).default([]),
  defaultPolicy: z.enum(['ask', 'deny']).default('ask'),
})

export const CocoonSettingsSchema = z.object({
  /** Start the Cocoon runner automatically once proxy + bridge + storage are ready. */
  autostart: z.boolean().default(false),
})

export const CocoonSettingsPartialSchema = z
  .object({
    autostart: z.boolean(),
  })
  .partial()

export type CocoonSettings = z.infer<typeof CocoonSettingsSchema>

export const BridgeSettingsPartialSchema = z
  .object({
    permissions: z.array(BridgePermissionSchema),
    defaultPolicy: z.enum(['ask', 'deny']),
  })
  .partial()

export type BridgePermission = z.infer<typeof BridgePermissionSchema>
export type BridgeSettings = z.infer<typeof BridgeSettingsSchema>
export type BridgeScope = 'blockchain' | 'p2p' | 'write'
export type BridgeDecision = 'granted' | 'denied' | 'session'

/**
 * Helper that makes a category schema optional (absent key = use all defaults).
 * In Zod v4, `.default({})` on a nested object does not apply inner field defaults,
 * so we use `.optional().transform()` to correctly fill all field-level defaults.
 */
function withCategoryDefaults<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return schema.optional().transform((v) => schema.parse(v ?? {}))
}

export const AppSettingsSchema = z.object({
  general: withCategoryDefaults(GeneralSettingsSchema),
  network: withCategoryDefaults(NetworkSettingsSchema),
  storage: withCategoryDefaults(StorageSettingsSchema),
  appearance: withCategoryDefaults(AppearanceSettingsSchema),
  privacy: withCategoryDefaults(PrivacySettingsSchema),
  contentFiltering: withCategoryDefaults(ContentFilteringSettingsSchema),
  advanced: withCategoryDefaults(AdvancedSettingsSchema),
  wallet: withCategoryDefaults(WalletSettingsSchema),
  bridge: withCategoryDefaults(BridgeSettingsSchema),
  cocoon: withCategoryDefaults(CocoonSettingsSchema),
})

// Partial validation schemas (no defaults) -- used to validate SETTINGS_SET updates.
// These validate types/constraints without filling in missing fields with defaults.
// Partial schemas for validating partial settings updates. Derived from the full
// schemas so field lists and constraints stay in sync, with field defaults stripped
// so only the keys actually supplied are validated and returned (partial-update
// semantics: absent keys must NOT be filled with defaults).
function partialUpdateSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = schema.shape as unknown as Record<string, z.ZodTypeAny>
  const stripped: Record<string, z.ZodTypeAny> = {}
  for (const key of Object.keys(shape)) {
    const field = shape[key]
    stripped[key] = field instanceof z.ZodDefault ? (field.removeDefault() as z.ZodTypeAny) : field
  }
  return z.object(stripped).partial()
}

export const GeneralSettingsPartialSchema = partialUpdateSchema(GeneralSettingsSchema)

export const NetworkSettingsPartialSchema = partialUpdateSchema(NetworkSettingsSchema)

export const StorageSettingsPartialSchema = partialUpdateSchema(StorageSettingsSchema)

export const AppearanceSettingsPartialSchema = partialUpdateSchema(AppearanceSettingsSchema)

export const PrivacySettingsPartialSchema = partialUpdateSchema(PrivacySettingsSchema)

export const ContentFilteringSettingsPartialSchema = partialUpdateSchema(ContentFilteringSettingsSchema)

export const AdvancedSettingsPartialSchema = partialUpdateSchema(AdvancedSettingsSchema)

// Derived TypeScript types from Zod schemas
export type ThemeColors = z.infer<typeof ThemeColorsSchema>
export type CustomTheme = z.infer<typeof CustomThemeSchema>
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>
export type NetworkSettings = z.infer<typeof NetworkSettingsSchema>
export type StorageSettings = z.infer<typeof StorageSettingsSchema>
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>
export type ContentFilteringSettings = z.infer<typeof ContentFilteringSettingsSchema>
export type AdvancedSettings = z.infer<typeof AdvancedSettingsSchema>
export type AppSettings = z.infer<typeof AppSettingsSchema>
