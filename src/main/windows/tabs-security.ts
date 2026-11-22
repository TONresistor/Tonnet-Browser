/**
 * Security handlers for tab WebContentsViews.
 * Intercepts navigation and popup creation to validate URLs and enforce scheme restrictions.
 */

import { resolve, sep } from 'path'
import { realpath } from 'fs/promises'
import { WebContentsView } from 'electron'
import { normalizeUrl } from '../../shared/utils/url'
import { loadErrorPage } from './tabs-storage'
import { createLogger } from '../../shared/logger'
import { emitContractToRenderer } from '../events/renderer-events'
import { BrowserUrlSchema, contextOpenLinkContract, pageNavigateContract } from '../../shared/ipc-contract/browsing'
import { DisposableStore, onWebContents } from '../utils/disposable'
import { isAbortedNavigation } from './navigation-failure'
import { loadUrlReportingFailure } from './page-load'

const log = createLogger('tabs-security')

/** Allowed URL schemes for navigation. */
export const ALLOWED_SCHEMES = ['http:']

/** A document may rewrite this many URLs before the chain is treated as a loop. */
const MAX_REWRITES_PER_DOCUMENT = 8

type TopLevelNavigationHandler = (url: string) => boolean
type NavigationDetails = Electron.Event<Electron.WebContentsWillNavigateEventParams>

interface NavigationGuard {
  onTopLevelNavigation?: TopLevelNavigationHandler
  captureNavigation: () => () => boolean
  /** Rewrite targets already used for this document; a repeat means a loop. */
  rewrittenTargets: Set<string>
}

function rewriteLoopMessage(target: string): string {
  let host = target
  try {
    host = new URL(target).hostname
  } catch {
    // Keep the whole URL when it does not parse; the message is diagnostic.
  }
  return `This page keeps redirecting through ${host}, which this browser cannot load over the TON proxy.`
}

async function openValidatedBagFile(
  view: WebContentsView,
  tabId: string,
  basePath: string,
  filePath: string,
  isCurrent: () => boolean
): Promise<void> {
  const fullPath = resolve(`${basePath}/${filePath}`)
  const safeBasePath = resolve(basePath)
  let realFullPath: string
  let realSafeBasePath: string
  try {
    ;[realFullPath, realSafeBasePath] = await Promise.all([realpath(fullPath), realpath(safeBasePath)])
  } catch (error) {
    log.event('warn', 'security.bagfile.unresolvable', 'blocked unresolvable bag file path', { error })
    return
  }
  if (!realFullPath.startsWith(realSafeBasePath + sep) && realFullPath !== realSafeBasePath) {
    log.event('warn', 'security.bagfile.path_traversal', 'blocked bag file path traversal')
    return
  }
  try {
    if (!isCurrent()) return
    await view.webContents.loadFile(realFullPath)
    if (!isCurrent()) return
    emitContractToRenderer(pageNavigateContract, {
      tabId,
      url: `file://${fullPath}`,
      canGoBack: true,
      canGoForward: false,
    })
  } catch (error) {
    log.event('error', 'storage.bagfile.load_failed', 'failed to load bag file', { error })
  }
}

function handleNavigation(view: WebContentsView, details: NavigationDetails, guard: NavigationGuard): void {
  const { url } = details
  try {
    const normalized = normalizeUrl(url)
    if (!BrowserUrlSchema.safeParse(normalized).success) {
      log.event('warn', 'security.navigation.invalid', 'blocked invalid navigation URL')
      details.preventDefault()
      return
    }
    const parsed = new URL(normalized)

    if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
      log.event('warn', 'security.navigation.blocked', 'blocked navigation to unsafe scheme', {
        scheme: parsed.protocol,
      })
      details.preventDefault()
      return
    }

    if (!details.isMainFrame || details.isSameDocument) return
    if (guard.onTopLevelNavigation?.(normalized)) {
      details.preventDefault()
      return
    }

    if (normalized !== url) {
      details.preventDefault()
      // An https target is rewritten to http, and a site that redirects back to
      // https produces the same target again: that is a loop, not a navigation.
      if (guard.rewrittenTargets.has(normalized) || guard.rewrittenTargets.size >= MAX_REWRITES_PER_DOCUMENT) {
        log.event('warn', 'security.navigation.rewrite_cycle', 'stopped a URL rewrite loop', {
          scheme: parsed.protocol,
        })
        loadErrorPage(view, rewriteLoopMessage(normalized), normalized)
        return
      }
      guard.rewrittenTargets.add(normalized)
      log.debug(`Normalizing URL: ${url} -> ${normalized}`)
      const isCurrent = guard.captureNavigation()
      loadUrlReportingFailure(view, normalized, (error) => {
        if (isAbortedNavigation(error) || !isCurrent()) return
        log.error('loadURL failed (normalization):', error)
        loadErrorPage(view, error.message, normalized)
      })
    }
  } catch (error) {
    log.debug('URL validation failed:', error)
    log.event('warn', 'security.navigation.invalid', 'blocked invalid navigation URL')
    details.preventDefault()
  }
}

/** Set up security event handlers on a view (will-navigate, setWindowOpenHandler, did-create-window). */
export function setupSecurityHandlers(
  view: WebContentsView,
  tabId: string,
  onTopLevelNavigation?: TopLevelNavigationHandler,
  captureNavigation: () => () => boolean = () => () => !view.webContents.isDestroyed()
): DisposableStore {
  const store = new DisposableStore()
  const guard: NavigationGuard = { onTopLevelNavigation, captureNavigation, rewrittenTargets: new Set() }

  // A committed document is a new context: rewrite targets start over.
  store.add(onWebContents(view.webContents, 'did-finish-load', () => guard.rewrittenTargets.clear()))

  // Security: Intercept navigation to validate URLs
  store.add(
    onWebContents(
      view.webContents,
      'will-navigate',
      (details: Electron.Event<Electron.WebContentsWillNavigateEventParams>) => {
        const { url } = details
        if (url.startsWith('bagfile://')) {
          details.preventDefault()
          if (!details.isMainFrame) return
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
            void openValidatedBagFile(view, tabId, bp, fp, captureNavigation())
          }
          return
        }

        handleNavigation(view, details, guard)
      }
    )
  )

  store.add(
    onWebContents(
      view.webContents,
      'will-redirect',
      (details: Electron.Event<Electron.WebContentsWillRedirectEventParams>) => {
        handleNavigation(view, details, guard)
      }
    )
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
        emitContractToRenderer(contextOpenLinkContract, targetUrl)
      } else {
        log.event('warn', 'security.popup.blocked', 'blocked popup to unsafe scheme', { scheme: parsed.protocol })
      }
    } catch (err) {
      log.debug('URL validation failed in popup handler:', err)
      log.event('warn', 'security.popup.invalid', 'blocked popup with invalid URL')
    }
    return { action: 'deny' }
  })

  // Fallback: Close any window that somehow gets created
  store.add(
    onWebContents(
      view.webContents,
      'did-create-window',
      (childWindow: Electron.BrowserWindow, { url }: { url: string }) => {
        log.event('warn', 'security.child_window.unexpected', 'unexpected child window closed')
        childWindow.close()
        if (url && url !== 'about:blank') {
          try {
            const targetUrl = normalizeUrl(url)
            const parsed = new URL(targetUrl)

            if (ALLOWED_SCHEMES.includes(parsed.protocol)) {
              emitContractToRenderer(contextOpenLinkContract, targetUrl)
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
