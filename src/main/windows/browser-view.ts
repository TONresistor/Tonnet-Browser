/**
 * WebContentsView factory for tab content.
 * Creates isolated views with TON proxy configured.
 */

import { WebContentsView, session } from 'electron'
import { USER_AGENT, FAVICON_MAX_SIZE_BYTES, SESSION_PARTITION } from '../../shared/constants'
import { getSetting } from '../settings'
import { contentFilterManager } from '../content-filter/filter-manager'
import { paymentInterceptor } from '../wallet/payment-interceptor'
import { createLogger } from '../../shared/logger'
import antiFingerprint from './anti-fingerprinting.js?raw'
const log = createLogger('browser-view')

export async function createTonSession(proxyPort: number, partitionName: string = SESSION_PARTITION) {
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

  // Content Filtering: Block ads, trackers, miners, and malicious content
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
    const { url, resourceType } = details

    // Check if request should be blocked
    if (contentFilterManager.isBlocked(url, resourceType)) {
      callback({ cancel: true })
      return
    }

    callback({})
  })

  // Privacy: Normalize headers, strip referer and ETag tracking headers
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['User-Agent'] = USER_AGENT
    headers['Accept-Language'] = 'en-US,en;q=0.9'
    // Strip referer to prevent navigation history leaks
    delete headers['Referer']
    delete headers['Referrer']
    // Strip ETag-related headers to prevent tracking (but allow local cache)
    delete headers['If-None-Match']
    delete headers['If-Modified-Since']
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

  // Privacy: Enforce no-referrer policy and strip ETag from responses
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Referrer-Policy'] = ['no-referrer']
    // Strip ETag to prevent tracking identifiers
    delete headers['ETag']
    delete headers['etag']
    callback({ responseHeaders: headers })
  })

  return ses
}

export function createBrowserView(ses: Electron.Session): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })

  // WebContentsView defaults to white background — prevent white flash
  view.setBackgroundColor('#0a0a0a')

  // Expose this WebContentsView to CDP (Chrome DevTools Protocol)
  // so agent-tonbrowser can inspect and interact with .ton page content.
  // Only attaches when remote debugging is active (--remote-debugging-port).
  if (process.argv.some((a) => a.startsWith('--remote-debugging-port'))) {
    try {
      view.webContents.debugger.attach('1.3')
    } catch {
      // Already attached or not available — safe to ignore
    }
  }

  // Privacy: Disable tracking APIs on every page load
  view.webContents.on('dom-ready', () => {
    view.webContents.executeJavaScript(antiFingerprint, true).catch((error) => {
      log.error('[Privacy] Failed to inject anti-fingerprinting code:', error)
    })
  })

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
  } catch (error) {
    // Silently fail - favicon is optional
    return null
  }
}
