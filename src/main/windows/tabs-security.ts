/**
 * Security handlers for tab WebContentsViews.
 * Intercepts navigation and popup creation to validate URLs and enforce scheme restrictions.
 */

import { resolve, sep } from 'path'
import { WebContentsView } from 'electron'
import { normalizeUrl } from '../../shared/utils/url'
import { loadErrorPage } from './tabs-storage'
import { createLogger } from '../../shared/logger'
import { emitToRenderer } from '../ipc/handlers/shared'
import { DisposableStore, onWebContents } from '../utils/disposable'

const log = createLogger('tabs-security')

/** Allowed URL schemes for navigation. */
export const ALLOWED_SCHEMES = ['http:']

/** Set up security event handlers on a view (will-navigate, setWindowOpenHandler, did-create-window). */
export function setupSecurityHandlers(view: WebContentsView, tabId: string): DisposableStore {
  const store = new DisposableStore()

  // Security: Intercept navigation to validate URLs
  store.add(
    onWebContents(view.webContents, 'will-navigate', (event: Electron.Event, url: string) => {
      // Handle bagfile:// links from file browser
      if (url.startsWith('bagfile://')) {
        event.preventDefault()
        const currentPageUrl = view.webContents.getURL()
        if (!currentPageUrl.startsWith('data:text/html')) {
          log.warn('Blocked bagfile:// from non-file-browser page')
          return
        }
        const withoutScheme = url.slice('bagfile://'.length)
        const slashIdx = withoutScheme.indexOf('/')
        if (slashIdx !== -1) {
          const bp = decodeURIComponent(withoutScheme.slice(0, slashIdx))
          const fp = decodeURIComponent(withoutScheme.slice(slashIdx + 1))
          const fullPath = resolve(`${bp}/${fp}`)
          const safeBp = resolve(bp)
          if (!fullPath.startsWith(safeBp + sep) && fullPath !== safeBp) {
            log.warn(`Blocked bagfile:// path traversal: ${fullPath}`)
            return
          }
          view.webContents
            .loadFile(fullPath)
            .then(() => {
              if (view.webContents.isDestroyed()) return
              emitToRenderer('page:navigate', {
                tabId,
                url: `file://${fullPath}`,
                canGoBack: true,
                canGoForward: false,
              })
            })
            .catch((err) => {
              log.error(`Failed to load bag file: ${fullPath}`, err)
            })
        }
        return
      }

      try {
        const normalized = normalizeUrl(url)
        const parsed = new URL(normalized)

        if (normalized !== url) {
          event.preventDefault()
          log.debug(`Normalizing URL: ${url} -> ${normalized}`)
          view.webContents.loadURL(normalized).catch((err) => {
            log.error('loadURL failed (normalization):', err)
            loadErrorPage(view, err.message, normalized)
          })
          return
        }

        if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
          log.warn(`Blocked navigation to unsafe URL: ${url}`)
          event.preventDefault()
        }
      } catch (err) {
        log.debug('URL validation failed in will-navigate:', err)
        log.warn(`Blocked navigation to invalid URL: ${url}`)
        event.preventDefault()
      }
    })
  )

  // Security: Control popup windows - open in new tab instead
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const targetUrl = normalizeUrl(url)
      const parsed = new URL(targetUrl)

      if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
        if (targetUrl !== url) {
          log.debug(`Normalizing popup URL: ${url} -> ${targetUrl}`)
        }
        emitToRenderer('context:open-link', targetUrl)
      } else {
        log.warn(`Blocked popup to unsafe URL: ${url}`)
      }
    } catch (err) {
      log.debug('URL validation failed in popup handler:', err)
      log.warn(`Blocked popup to invalid URL: ${url}`)
    }
    return { action: 'deny' }
  })

  // Fallback: Close any window that somehow gets created
  store.add(
    onWebContents(
      view.webContents,
      'did-create-window',
      (childWindow: Electron.BrowserWindow, { url }: { url: string }) => {
        log.warn(`Unexpected child window created, closing and redirecting: ${url}`)
        childWindow.close()
        if (url && url !== 'about:blank') {
          try {
            const targetUrl = normalizeUrl(url)
            const parsed = new URL(targetUrl)

            if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
              emitToRenderer('context:open-link', targetUrl)
            }
          } catch {
            log.debug(`Invalid URL in child window: ${url}`)
          }
        }
      }
    )
  )

  return store
}
