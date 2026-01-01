/**
 * Factory functions for creating test data
 * Use these instead of inline objects - keeps tests DRY
 */

// ============================================
// SETTINGS FACTORIES
// ============================================

export const createDefaultSettings = (overrides: Record<string, unknown> = {}) => ({
  general: {
    homepage: 'ton://start',
    ...((overrides.general as Record<string, unknown>) || {}),
  },
  network: {
    proxyPort: 8080,
    storagePort: 5555,
    autoConnect: false,
    connectionTimeout: 30,
    syncCheckInterval: 3000,
    ...((overrides.network as Record<string, unknown>) || {}),
  },
  storage: {
    downloadPath: '/mock/storage',
    ...((overrides.storage as Record<string, unknown>) || {}),
  },
  appearance: {
    defaultZoom: 100,
    zoomMin: 30,
    zoomMax: 300,
    ...((overrides.appearance as Record<string, unknown>) || {}),
  },
  privacy: {
    clearOnExit: true,
    ...((overrides.privacy as Record<string, unknown>) || {}),
  },
  advanced: {
    proxyVerbosity: 2,
    storageVerbosity: 2,
    syncTestDomain: 'test.ton',
    ...((overrides.advanced as Record<string, unknown>) || {}),
  },
})

// ============================================
// TAB FACTORIES
// ============================================

export const createMockTab = (overrides: Record<string, unknown> = {}) => ({
  id: overrides.id || 'test-tab-' + Math.random().toString(36).slice(2, 7),
  url: 'ton://start',
  title: 'New Tab',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  history: ['ton://start'],
  historyIndex: 0,
  ...overrides,
})

// ============================================
// STORAGE BAG FACTORIES
// ============================================

export const VALID_BAG_ID = 'a'.repeat(64)
export const INVALID_BAG_IDS = [
  '', // empty
  'abc', // too short
  'z'.repeat(64), // invalid hex char
  'A'.repeat(63), // 63 chars
  'A'.repeat(65), // 65 chars
  null,
  undefined,
  123,
]

export const createMockBag = (overrides: Record<string, unknown> = {}) => ({
  bagId: VALID_BAG_ID,
  name: 'Test Bag',
  size: 1024000,
  downloaded: 512000,
  uploaded: 256000,
  status: 'active' as const,
  peers: 5,
  speed: { download: 1000, upload: 500 },
  ...overrides,
})

export const createMockBagDetails = (overrides: Record<string, unknown> = {}) => ({
  ...createMockBag(overrides),
  files: [
    { name: 'file1.txt', size: 1024 },
    { name: 'file2.txt', size: 2048 },
  ],
  description: 'Test bag description',
  createdAt: Date.now(),
  ...overrides,
})

// ============================================
// PROXY STATUS FACTORIES
// ============================================

export type ProxyStatus = 'stopped' | 'starting' | 'syncing' | 'connected'

export const createMockProxyStatus = (status: ProxyStatus = 'stopped') => ({
  status,
  port: 8080,
  isRunning: status !== 'stopped',
  isSynced: status === 'connected',
})

// ============================================
// BOOKMARK FACTORIES
// ============================================

export const createMockBookmark = (overrides: Record<string, unknown> = {}) => ({
  id: 'bookmark-' + Math.random().toString(36).slice(2, 7),
  title: 'Test Bookmark',
  url: 'http://example.ton',
  ...overrides,
})

export const DEFAULT_BOOKMARKS = [
  { id: 'default-1', title: 'TON Foundation', url: 'http://foundation.ton' },
  { id: 'default-2', title: 'TON DNS', url: 'http://dns.ton' },
]

// ============================================
// URL TEST CASES
// ============================================

export const VALID_URLS = [
  'http://example.com',
  'https://example.com',
  'http://example.ton',
  'ton://start',
  'ton://settings',
  'ton://storage',
]

export const DANGEROUS_URLS = [
  { url: 'javascript:alert(1)', reason: 'XSS' },
  { url: 'data:text/html,<script>alert(1)</script>', reason: 'Data URI' },
  { url: 'file:///etc/passwd', reason: 'Local file' },
  { url: 'vbscript:msgbox', reason: 'VBScript' },
]
