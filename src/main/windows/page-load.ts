/**
 * Page-load safety nets.
 *
 * Every request leaves through the local TON proxy, so a host it cannot answer
 * never settles: no `did-fail-load`, no `did-stop-loading`, and the tab keeps a
 * spinner over a page that is not there.
 *
 * Two mechanisms, because a load can die in two ways:
 *  - `loadUrlReportingFailure` maps a rejected `loadURL` to the caller's error page.
 *  - `armLoadWatchdog` owns the deadline for the view itself. A per-promise timer
 *    cannot survive a replacement navigation: the replaced load settles at once
 *    with ERR_ABORTED, which clears the timer while the view keeps loading.
 */

import type { WebContentsView } from 'electron'
import { PAGE_LOAD_TIMEOUT_MS } from './constants'

/** Reports a failed `loadURL` to the caller, which decides whether it matters. */
export function loadUrlReportingFailure(view: WebContentsView, url: string, onFailure: (error: Error) => void): void {
  void view.webContents.loadURL(url).then(
    () => undefined,
    (error: Error) => onFailure(error)
  )
}

/**
 * Arms one deadline for a view and returns its cancel function. It only fires
 * while the view is still loading, so a page that finished is never touched.
 */
export function armLoadWatchdog(
  view: WebContentsView,
  onTimeout: () => void,
  timeoutMs: number = PAGE_LOAD_TIMEOUT_MS
): () => void {
  const timer = setTimeout(() => {
    if (view.webContents.isDestroyed() || !view.webContents.isLoading()) return
    onTimeout()
  }, timeoutMs)
  return () => clearTimeout(timer)
}
