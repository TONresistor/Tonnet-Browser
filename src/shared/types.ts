/**
 * Shared types.
 * Used by both main and renderer processes.
 */

export interface Tab {
  id: string
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon?: string
  createdAt: number
}

export interface ProxyStatus {
  connected: boolean
  port: number
  error?: string
}

export interface StorageBag {
  id: string
  name: string
  size: number
  downloaded: number
  uploadSpeed: number
  downloadSpeed: number
  peers: number
  filesCount: number
  status: 'downloading' | 'seeding' | 'paused' | 'error'
}

export interface BagDetails {
  bag_id: string
  description: string
  files: Array<{ name: string; size: number }>
  peers: Array<{ addr: string; download_speed: number; upload_speed: number }>
  merkle_hash: string
  piece_size: number
  path: string
  downloaded: number
  size: number
  active: boolean
  seeding: boolean
  dir_name?: string // Directory name from storage daemon response
}

export interface ContentFilterStats {
  totalBlocked: number
  totalAllowed: number
  blockedByCategory: {
    ads: number
    trackers: number
    miners: number
    malware: number
    annoyances: number
  }
  sessionStarted: number
}

export interface ContentFilterEvent {
  url: string
  resourceType: string
  category: 'ads' | 'trackers' | 'miners' | 'malware' | 'annoyances'
  description: string
  timestamp: number
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  visitedAt: number
  visitCount: number
  favicon?: string
}

export interface HistoryStats {
  total: number
  mode: 'memory' | 'persistent'
  oldestEntry?: number
  newestEntry?: number
  isLocked: boolean
}

// --- Wallet types ---

export type PaymentMode = 'off' | 'manual' | 'auto'
export type NotificationStyle = 'popup' | 'addressbar'

export interface SpendingLimits {
  perRequest: string
  perDay: string
  perSitePerMonth: string
}

export interface SitePolicy {
  domain: string
  mode: PaymentMode
  customLimits?: SpendingLimits
  totalSpent: string
  lastPayment?: number
}

export interface WalletState {
  isCreated: boolean
  address: string
  addressRaw: string
  publicKey: string
  balance: string
  decryptFailed?: boolean
  weakEncryption?: boolean
  isLocked?: boolean
}

export interface WalletTransaction {
  id: string
  type: 'send' | 'receive' | 'x402'
  amount: string
  address: string
  timestamp: number
  status: 'pending' | 'confirmed' | 'failed'
  hash?: string
  x402Domain?: string
  x402Url?: string
}

export interface PaymentRequirements {
  scheme: string
  network: string
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: {
    relayAddress?: string
    maxRelayCommission?: string
    assetDecimals: number
    assetSymbol: string
  }
}

export interface ExactTonPayload {
  signedBoc: string
  walletPublicKey: string
  walletAddress: string
  seqno: number
  validUntil: number
}

export interface PaymentNotificationData {
  id: string
  domain: string
  url: string
  amount: string
  payTo: string
  /** User-friendly non-bounceable representation of payTo, when derivable. */
  payToFriendly?: string
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed'
  error?: string
}

export interface WalletSettings {
  paymentMode: PaymentMode
  notificationStyle: NotificationStyle
  limits: SpendingLimits
  sitePolicies: SitePolicy[]
  autoPayDomains: string[]
  autoLockMinutes: number
}

/** DNS resolve result from the bridge */
export interface DnsResolveResult {
  wallet: string | null
  site_adnl: string | null
  has_storage: boolean
  owner: string | null
  nft_address: string | null
  collection: string | null
  editor: string | null
  initialized: boolean
  expiring_at: number | null
  text_records?: Record<string, string>
}

// Re-export ThemeType from defaults for backward compatibility
export type { ThemeType, BuiltInTheme } from './defaults'

// Re-export schemas and IPC channels for backward compatibility
// Use `export type` for schema inferred types to prevent Zod runtime from leaking into renderer bundle
export type {
  GeneralSettings,
  NetworkSettings,
  StorageSettings,
  AppearanceSettings,
  PrivacySettings,
  ContentFilteringSettings,
  AdvancedSettings,
  AppSettings,
  ThemeColors,
  CustomTheme,
  BridgePermission,
  BridgeSettings,
} from './schemas'
export {
  GeneralSettingsSchema,
  NetworkSettingsSchema,
  StorageSettingsSchema,
  AppearanceSettingsSchema,
  PrivacySettingsSchema,
  ContentFilteringSettingsSchema,
  AdvancedSettingsSchema,
  WalletSettingsSchema,
  BridgeSettingsSchema,
  AppSettingsSchema,
  ThemeTypeSchema,
  ThemeColorsSchema,
  CustomThemeSchema,
  GeneralSettingsPartialSchema,
  NetworkSettingsPartialSchema,
  StorageSettingsPartialSchema,
  AppearanceSettingsPartialSchema,
  PrivacySettingsPartialSchema,
  ContentFilteringSettingsPartialSchema,
  AdvancedSettingsPartialSchema,
  WalletSettingsPartialSchema,
  BridgeSettingsPartialSchema,
  type BridgeScope,
  type BridgeDecision,
} from './schemas'
export { IPC_CHANNELS } from './ipc-channels'
