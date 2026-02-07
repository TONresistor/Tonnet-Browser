/**
 * Security validation functions.
 * URL validation, BagID validation, and rate limiting.
 */

// Security: URL validation for navigation
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'ton:'])
const BLOCKED_SCHEMES = new Set([
  'javascript:', // XSS vector
  'data:',       // XSS vector
  'file:',       // Local file access
  'vbscript:',   // XSS vector
  'blob:',       // XSS vector
  'about:',      // Bypass proxy
  'ws:',         // IP leak via WebSocket
  'wss:',        // IP leak via WebSocket (secure)
])

export function isValidNavigationUrl(url: string): { valid: boolean; error?: string } {
  // Allow internal ton:// URLs
  if (url.startsWith('ton://')) {
    return { valid: true }
  }

  // Try to parse as URL (add http:// if no scheme)
  let urlToParse = url
  if (!url.includes('://')) {
    urlToParse = `http://${url}`
  }

  try {
    const parsed = new URL(urlToParse)

    // Block dangerous schemes first
    if (BLOCKED_SCHEMES.has(parsed.protocol)) {
      return { valid: false, error: `Blocked scheme: ${parsed.protocol}` }
    }

    // Then check whitelist
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      return { valid: false, error: `Disallowed scheme: ${parsed.protocol}` }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

// Security: Bag ID validation (64-char hex string)
export function isValidBagId(bagId: string): boolean {
  return typeof bagId === 'string' && /^[a-fA-F0-9]{64}$/.test(bagId)
}

// Security: Validate download path
export function isValidDownloadPath(inputPath: string): { valid: boolean; error?: string } {
  const path = require('path')
  const os = require('os')

  // Must be a non-empty string
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    return { valid: false, error: 'Path must be a non-empty string' }
  }

  // Must be absolute path
  if (!path.isAbsolute(inputPath)) {
    return { valid: false, error: 'Path must be absolute' }
  }

  // Normalize to resolve .. and .
  const normalized = path.normalize(inputPath)

  // Block system directories (Unix/Linux/macOS)
  if (process.platform !== 'win32') {
    const blockedPaths = [
      '/bin', '/sbin', '/usr', '/etc', '/var', '/sys', '/proc', '/dev', '/boot', '/lib', '/lib64',
      '/root', '/opt', '/srv', '/snap', '/run'
    ]
    for (const blocked of blockedPaths) {
      if (normalized === blocked || normalized.startsWith(blocked + '/')) {
        return { valid: false, error: 'System directories are not allowed' }
      }
    }
  } else {
    // Block system directories (Windows)
    const blockedPaths = [
      'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)',
      'C:\\ProgramData', 'C:\\System', 'C:\\$', 'C:\\Boot'
    ]
    for (const blocked of blockedPaths) {
      const blockedNormalized = path.normalize(blocked).toLowerCase()
      const normalizedLower = normalized.toLowerCase()
      if (normalizedLower === blockedNormalized || normalizedLower.startsWith(blockedNormalized + path.sep)) {
        return { valid: false, error: 'System directories are not allowed' }
      }
    }
  }

  // Must be under home directory or common user-writable paths
  const home = os.homedir()
  const allowedRoots = [home]

  if (process.platform === 'win32') {
    // Windows: allow any drive letter under Users or common data paths
    allowedRoots.push(
      path.join(process.env.USERPROFILE || '', '..'),
      process.env.APPDATA || '',
      process.env.LOCALAPPDATA || ''
    )
  } else {
    // Unix: allow /tmp, /home, and user home
    allowedRoots.push('/tmp', '/home')
  }

  const isAllowed = allowedRoots.some(root => root && normalized.startsWith(root))
  if (!isAllowed) {
    return { valid: false, error: 'Path must be in user-accessible directory' }
  }

  return { valid: true }
}

// Security: Simple rate limiter to prevent IPC spam
export class RateLimiter {
  private calls: number[] = []
  private maxCalls: number
  private windowMs: number

  constructor(maxCalls: number, windowMs: number) {
    this.maxCalls = maxCalls
    this.windowMs = windowMs
  }

  check(): boolean {
    const now = Date.now()
    this.calls = this.calls.filter(t => now - t < this.windowMs)
    if (this.calls.length >= this.maxCalls) {
      return false
    }
    this.calls.push(now)
    return true
  }

  reset(): void {
    this.calls = []
  }
}
