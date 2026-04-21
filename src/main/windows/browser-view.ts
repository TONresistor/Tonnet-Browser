/**
 * WebContentsView factory for tab content.
 * Creates isolated views with TON proxy configured.
 */

import { WebContentsView, session } from 'electron'
import { join } from 'path'
import { USER_AGENT, FAVICON_MAX_SIZE_BYTES, SESSION_PARTITION } from './constants'
import { getSetting } from '../settings'
import type { ContentFilterManager } from '../content-filter/filter-manager'
import type { PaymentInterceptor } from '../wallet/payment-interceptor'
import { createLogger } from '../../shared/logger'
const log = createLogger('browser-view')

/** Dependencies needed by createTonSession */
export interface SessionDeps {
  contentFilterManager: ContentFilterManager
  paymentInterceptor: PaymentInterceptor
}

// Module-level deps, set once via setSessionDeps()
let sessionDeps: SessionDeps | null = null

/** Set the shared session dependencies. Called once from initTabManager(). */
export function setSessionDeps(deps: SessionDeps): void {
  sessionDeps = deps
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // localhost and subdomains
  if (h === 'localhost' || h.endsWith('.localhost')) return true

  // IPv6 loopback
  if (h === '::1' || h === '::') return true

  // IPv6-mapped IPv4 loopback (::ffff:127.x.x.x or ::ffff:0.x.x.x)
  // new URL('http://[::ffff:127.0.0.1]/').hostname returns '::ffff:7f00:1' (hex form)
  if (h.startsWith('::ffff:')) {
    const suffix = h.slice(7)
    // Hex form (actual URL parser output): ::ffff:7f00:1, ::ffff:0:0
    const hexMatch = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMatch) {
      const high = parseInt(hexMatch[1], 16)
      if (high >> 8 === 0x7f || high === 0) return true
    }
    // Dotted form (defense in depth): ::ffff:127.0.0.1
    const dottedMatch = suffix.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (dottedMatch) {
      const first = parseInt(dottedMatch[1], 10)
      if (first === 127 || first === 0) return true
    }
  }

  // 0.0.0.0
  if (h === '0.0.0.0') return true

  // IPv4: check the full 127.0.0.0/8 range and 0.0.0.0/8
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    const first = parseInt(ipv4Match[1], 10)
    if (first === 127) return true
    if (first === 0) return true
  }

  return false
}

export async function createTonSession(proxyPort: number, partitionName: string = SESSION_PARTITION) {
  if (!sessionDeps) throw new Error('Session dependencies not initialized. Call setSessionDeps() first.')
  const { contentFilterManager, paymentInterceptor } = sessionDeps

  const ses = session.fromPartition(partitionName)

  // Configure proxy - route ALL requests through proxy (no bypass)
  // MUST await: loadURL before proxy is ready causes ERR_ABORTED (-3)
  await ses.setProxy({
    proxyRules: `http://127.0.0.1:${proxyPort}`,
  })

  // Block all permissions by default (privacy)
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)

  // Set uniform User-Agent
  ses.setUserAgent(USER_AGENT)

  // Sync content filter settings from user preferences
  contentFilterManager.applySettings(getSetting('contentFiltering'))

  // Content Filtering + WS blocking: single handler for all request types
  ses.webRequest.onBeforeRequest((details, callback) => {
    const { url, resourceType } = details

    // Block ALL requests to loopback addresses (SSRF protection)
    try {
      const parsed = new URL(url)
      if (isLoopbackHost(parsed.hostname)) {
        log.info(`Blocked request to loopback: ${url}`)
        callback({ cancel: true })
        return
      }
    } catch {
      // Invalid URL, fall through to content filter
    }

    // Check if request should be blocked by content filter
    if (contentFilterManager.isBlocked(url, resourceType)) {
      callback({ cancel: true })
      return
    }

    callback({})
  })

  // Privacy: Normalize headers, strip referer and ETag tracking headers
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const wcId = details.webContentsId
    const xPaymentToken =
      typeof wcId === 'number' && wcId >= 0 ? paymentInterceptor.consumeXhrPaymentToken(wcId, details.url) : null
    const headers = { ...details.requestHeaders }
    if (xPaymentToken) {
      headers['X-PAYMENT'] = xPaymentToken
    }
    headers['User-Agent'] = USER_AGENT
    headers['Accept-Language'] = 'en-US,en;q=0.9'
    // Strip referer to prevent navigation history leaks
    delete headers['Referer']
    delete headers['Referrer']
    // Strip ETag-related headers to prevent tracking (but allow local cache)
    delete headers['If-None-Match']
    delete headers['If-Modified-Since']
    // Strip Client Hints headers to prevent platform/version fingerprinting
    delete headers['Sec-CH-UA']
    delete headers['Sec-CH-UA-Platform']
    delete headers['Sec-CH-UA-Mobile']
    delete headers['Sec-CH-UA-Full-Version-List']
    delete headers['Sec-CH-UA-Arch']
    delete headers['Sec-CH-UA-Bitness']
    delete headers['Sec-CH-UA-Model']
    // Optional: Force no-cache for maximum privacy (user setting)
    const { disableCache } = getSetting('privacy')
    if (disableCache) {
      headers['Cache-Control'] = 'no-cache'
      headers['Pragma'] = 'no-cache'
    }
    callback({ requestHeaders: headers })
  })

  // Register 402 payment interceptor on this session
  paymentInterceptor.registerOnSession(ses)

  // Privacy: Enforce no-referrer policy, strip ETag, and add CSP
  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Referrer-Policy'] = ['no-referrer']
    // Strip ETag to prevent tracking identifiers
    delete headers['ETag']
    delete headers['etag']
    // CSP: block object embeds, base-uri hijacking, and clickjacking
    // Intentionally does NOT restrict script-src/default-src to avoid breaking .ton sites
    headers['Content-Security-Policy'] = [
      "script-src * 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ]
    callback({ responseHeaders: headers })
  })

  return ses
}

export function createBrowserView(ses: Electron.Session): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../../resources/preload/tonsite.js'),
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })

  // WebContentsView defaults to white background -- prevent white flash
  view.setBackgroundColor('#0a0a0a')

  // Expose this WebContentsView to CDP (Chrome DevTools Protocol)
  // so agent-tonbrowser can inspect and interact with .ton page content.
  // Only attaches when remote debugging is active (--remote-debugging-port).
  if (process.argv.some((a) => a.startsWith('--remote-debugging-port'))) {
    try {
      view.webContents.debugger.attach('1.3')
    } catch {
      // Already attached or not available -- safe to ignore
    }
  }

  return view
}

/**
 * Extract favicon from a page.
 * Returns favicon data URL (base64) or null if not found.
 */
export async function extractFavicon(view: WebContentsView): Promise<string | null> {
  try {
    // Try multiple methods to find favicon
    const faviconDataUrl = await view.webContents.executeJavaScript(`
      (function() {
        // Method 1: Look for link rel="icon" or rel="shortcut icon"
        const iconLinks = Array.from(document.querySelectorAll('link[rel*="icon"]'));

        for (const link of iconLinks) {
          const href = link.getAttribute('href');
          if (href) {
            // Convert relative URLs to absolute
            try {
              const url = new URL(href, window.location.href);
              // Security: Only allow http/https schemes
              if (!url.protocol.match(/^https?:/)) {
                continue;
              }
              return url.href;
            } catch {
              continue;
            }
          }
        }

        // Method 2: Default /favicon.ico
        try {
          const defaultFavicon = new URL('/favicon.ico', window.location.origin);
          return defaultFavicon.href;
        } catch {
          return null;
        }
      })();
    `)

    if (!faviconDataUrl) return null

    // Fetch the favicon and convert to base64 data URL
    const faviconBase64 = await view.webContents.executeJavaScript(`
      (async function() {
        const url = ${JSON.stringify(faviconDataUrl)};
        try {
          const response = await fetch(url);
          if (!response.ok) return null;

          const blob = await response.blob();

          if (blob.size > ${FAVICON_MAX_SIZE_BYTES}) {
            return null;
          }

          const reader = new FileReader();

          return new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          return null;
        }
      })();
    `)

    // Validate result size (data URL should be < ~70KB for 50KB blob)
    if (faviconBase64 && typeof faviconBase64 === 'string' && faviconBase64.length > 70000) {
      return null
    }

    return faviconBase64 as string | null
  } catch {
    // Silently fail - favicon is optional
    return null
  }
}
