/**
 * BrowserView factory for tab content.
 * Creates isolated views with TON proxy configured.
 */

import { BrowserView, session } from 'electron'
import { USER_AGENT } from '../../shared/constants'

const SESSION_PARTITION = 'persist:ton-browser'

export function createTonSession(proxyPort: number) {
  const ses = session.fromPartition(SESSION_PARTITION)

  // Configure proxy
  ses.setProxy({
    proxyRules: `http://127.0.0.1:${proxyPort}`,
    proxyBypassRules: '<local>',
  })

  // Block all permissions by default (privacy)
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Set uniform User-Agent
  ses.setUserAgent(USER_AGENT)

  // Privacy: Normalize headers, strip referer
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['User-Agent'] = USER_AGENT
    headers['Accept-Language'] = 'en-US,en;q=0.9'
    // Strip referer to prevent navigation history leaks
    delete headers['Referer']
    delete headers['Referrer']
    callback({ requestHeaders: headers })
  })

  // Privacy: Enforce no-referrer policy on responses
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    headers['Referrer-Policy'] = ['no-referrer']
    callback({ responseHeaders: headers })
  })

  return ses
}

export function createBrowserView(ses: Electron.Session): BrowserView {
  const view = new BrowserView({
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

  // Privacy: Disable tracking APIs on every page load
  view.webContents.on('dom-ready', () => {
    view.webContents.executeJavaScript(`
      // Disable Battery API (fingerprinting)
      if (navigator.getBattery) {
        Object.defineProperty(navigator, 'getBattery', {
          value: () => Promise.reject('Battery API disabled for privacy'),
          writable: false
        });
      }

      // Disable Sensor APIs (fingerprinting)
      window.DeviceMotionEvent = undefined;
      window.DeviceOrientationEvent = undefined;
    `, true).catch(() => {});
  })

  return view
}
