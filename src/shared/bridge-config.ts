/**
 * Bridge configuration types and constants.
 * Mirrors the Go tonutils-bridge config.json structure.
 */

import { z } from 'zod'

// --- Namespace identifiers ---

export const REQUIRED_NAMESPACES = ['lite', 'wallet', 'subscribe', 'dns'] as const
export const OPTIONAL_NAMESPACES = [
  'jetton',
  'nft',
  'sbt',
  'payment',
  'network',
  'adnl',
  'overlay',
  'dht',
  'subscribe_trace',
] as const
export const ALL_NAMESPACES = [...REQUIRED_NAMESPACES, ...OPTIONAL_NAMESPACES] as const

export type RequiredNamespace = (typeof REQUIRED_NAMESPACES)[number]
export type OptionalNamespace = (typeof OPTIONAL_NAMESPACES)[number]
export type NamespaceKey = (typeof ALL_NAMESPACES)[number]

// --- Namespace config types (match Go structs) ---

export interface BaseNamespaceConfig {
  enabled?: boolean
  timeout?: string
}

export interface LiteNamespaceConfig extends BaseNamespaceConfig {
  send_wait_timeout?: string
  watch_timeout?: string
}

export interface SubscribeNamespaceConfig extends BaseNamespaceConfig {
  max_subscriptions?: number
  max_multi_accounts?: number
  max_config_params?: number
}

export interface TraceNamespaceConfig extends BaseNamespaceConfig {
  max_depth?: number
  default_depth?: number
  max_msg_timeout?: string
  default_msg_timeout?: string
  max_resolvers?: number
}

export interface ADNLNamespaceConfig extends BaseNamespaceConfig {
  max_peers?: number
  query_max_timeout?: string
  ssrf_protection?: boolean
}

export interface OverlayNamespaceConfig extends BaseNamespaceConfig {
  max_overlays?: number
  query_max_timeout?: string
}

export interface DHTNamespaceConfig extends BaseNamespaceConfig {
  tunnel_timeout?: string
  allow_write?: boolean
}

export interface NamespacesConfig {
  lite: LiteNamespaceConfig
  subscribe: SubscribeNamespaceConfig
  subscribe_trace: TraceNamespaceConfig
  adnl: ADNLNamespaceConfig
  overlay: OverlayNamespaceConfig
  dht: DHTNamespaceConfig
  jetton: BaseNamespaceConfig
  nft: BaseNamespaceConfig
  dns: BaseNamespaceConfig
  wallet: BaseNamespaceConfig
  sbt: BaseNamespaceConfig
  payment: BaseNamespaceConfig
  network: BaseNamespaceConfig
}

export interface WebSocketConfig {
  write_timeout?: string
  pong_deadline?: string
  max_inflight?: number
  max_message_size?: number
}

export interface BridgeConfig {
  version: number
  listen?: string
  verbosity?: number
  tunnel_sections?: number
  max_clients?: number
  allowed_origins?: string[]
  api_key?: string
  websocket: WebSocketConfig
  namespaces: NamespacesConfig
  // Pass-through for unknown fields (future Go versions)
  [key: string]: unknown
}

// --- Default namespace state ---
// Principle of least privilege: only enable namespaces the browser actively uses.
// Required: used by WsBridgeClient for core wallet/DNS operations.
// Optional: disabled by default, users can enable via Settings > Bridge for dApp use.
//
// Usage map (2026-04-07 audit):
//   lite:            5 internal methods (getAccountState, sendMessage, getTransactions, sendAndWatch, runMethod)
//   subscribe:       3 internal methods (accountState, transactions, unsubscribe)
//   wallet:          1 internal method  (getSeqno)
//   dns:             1 internal method  (resolve)
//   adnl/overlay/dht: dApp passthrough only (p2p/write scope, permission-gated)
//   jetton/nft/sbt/payment/network/subscribe_trace: no usage in codebase

export const DEFAULT_NAMESPACE_STATE: Record<NamespaceKey, boolean> = {
  // Required by browser internals
  lite: true,
  wallet: true,
  subscribe: true,
  dns: true,
  // dApp-only: enable on demand via Settings > Bridge
  adnl: false,
  overlay: false,
  dht: false,
  // Unused: no method calls in codebase
  subscribe_trace: false,
  jetton: false,
  nft: false,
  sbt: false,
  payment: false,
  network: false,
}

// --- Helpers ---

export function isRequiredNamespace(ns: NamespaceKey): ns is RequiredNamespace {
  return (REQUIRED_NAMESPACES as readonly string[]).includes(ns)
}

/**
 * Structural validation for a partial bridge-config update from the renderer.
 * The config is intentionally open-ended (index signature), so this only enforces
 * the merged shapes: namespaces must be a record of objects and websocket an object;
 * other top-level keys pass through. Rejects primitives/arrays/malformed namespaces.
 */
const NamespaceEntrySchema = z.object({ enabled: z.boolean().optional() }).passthrough()
export const BridgeConfigPartialSchema = z
  .object({
    namespaces: z.record(z.string(), NamespaceEntrySchema).optional(),
    websocket: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
