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
import { isPrivateHost } from '../utils/private-host'
const log = createLogger('browser-view')

/** Dependencies needed by createTonSession */
export interface SessionDeps {
  contentFilterManager: ContentFilterManager
  paymentInterceptor: PaymentInterceptor
}

/** Route ALL requests through the local proxy (no bypass). Must await before any loadURL. */
async function installProxy(ses: Electron.Session, proxyPort: number): Promise<void> {
  // MUST await: loadURL before proxy is ready causes ERR_ABORTED (-3)
  await ses.setProxy({
    proxyRules: `http://127.0.0.1:${proxyPort}`,
  })
}

/** Block all permission / device-permission requests by default (privacy). */
function installPermissionHandlers(ses: Electron.Session): void {
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
}

/**
 * Host of the top-level document a request belongs to, used to tell the site's
 * own resources apart from third-party ones. Falls back to the session's domain
 * when the frame is gone (destroyed or cross-process teardown).
 */
function resolveFirstPartyHost(details: Electron.OnBeforeRequestListenerDetails, sessionHost: string | null) {
  try {
    const topUrl = details.frame?.top?.url
    if (topUrl) {
      const host = new URL(topUrl).hostname
      if (host) return host.toLowerCase()
    }
  } catch {
    // Frame already destroyed — fall back to the session domain below.
  }
  return sessionHost
}

/** Cancel loopback (SSRF) and content-filtered requests. */
function installRequestFilter(
  ses: Electron.Session,
  contentFilterManager: ContentFilterManager,
  sessionHost: string | null
): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const { url, resourceType } = details

    // Block ALL requests to loopback addresses (SSRF protection)
    try {
      const parsed = new URL(url)
      if (isPrivateHost(parsed.hostname)) {
        log.event('warn', 'security.request.private_host', 'blocked request to private host')
        callback({ cancel: true })
        return
      }
    } catch {
      // Invalid URL, fall through to content filter
    }

    // Check if request should be blocked by content filter
    if (contentFilterManager.isBlocked(url, resourceType, resolveFirstPartyHost(details, sessionHost))) {
      callback({ cancel: true })
      return
    }

    callback({})
  })
}

/** Normalize request headers, strip referer/ETag/client-hints, inject X-PAYMENT, optional no-cache. */
function installHeaderPrivacy(ses: Electron.Session, paymentInterceptor: PaymentInterceptor): void {
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
}

/** Enforce no-referrer policy, strip ETag, and set the response CSP. */
function installResponseSecurity(ses: Electron.Session): void {
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
}

export async function createTonSession(
  deps: SessionDeps,
  proxyPort: number,
  partitionName: string = SESSION_PARTITION,
  sessionHost: string | null = null
) {
  const { contentFilterManager, paymentInterceptor } = deps

  const ses = session.fromPartition(partitionName)

  await installProxy(ses, proxyPort)
  installPermissionHandlers(ses)
  ses.setUserAgent(USER_AGENT)
  // Sync content filter settings from user preferences before the request filter runs
  contentFilterManager.applySettings(getSetting('contentFiltering'))
  installRequestFilter(ses, contentFilterManager, sessionHost)
  installHeaderPrivacy(ses, paymentInterceptor)
  // Register 402 payment interceptor on this session
  paymentInterceptor.registerOnSession(ses)
  installResponseSecurity(ses)

  return ses
}

export function createBrowserView(ses: Electron.Session, defaultZoom: number): WebContentsView {
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
      // Enable Chromium's built-in PDFium viewer so PDFs served by a tonsite
      // render inline instead of failing silently. Electron ships only the PDF
      // plugin, so this does not enable NPAPI/Flash.
      plugins: true,
    },
  })

  view.webContents.setZoomFactor(defaultZoom / 100)

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
