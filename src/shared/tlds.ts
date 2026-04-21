// Source of truth for TLDs the shipped tonutils-proxy-ws can resolve (v1.9.5).
// Native (proxy.go HasSuffix): .ton, .adnl, .t.me
// Multi-chain resolver package (resolver/): .eth (ENS), .sol (SNS)
export const SUPPORTED_TLDS = ['.ton', '.adnl', '.t.me', '.eth', '.sol'] as const

// TLDs whose resolver can be disabled via CLI flag (proxy v1.9.5)
// Maps setting key -> TLD suffix
export const DISABLEABLE_CHAINS = {
  eth: '.eth',
  sol: '.sol',
} as const

export type DisableableChainKey = keyof typeof DISABLEABLE_CHAINS
