/**
 * Bounded page loads.
 *
 * Every request leaves through the local TON proxy, so a host the proxy cannot
 * answer leaves `loadURL` pending forever: no `did-fail-load`, no
 * `did-stop-loading`, and the tab keeps a spinner over a page that is not there.
 * Racing the load against a deadline turns that silent hang into a normal load
 * failure the caller can render.
 */

import type { WebContentsView } from 'electron'

export const PAGE_LOAD_TIMEOUT_MS = 30_000

export interface BoundedLoadHandlers {
  /** False once another navigation superseded this one; the deadline is then ignored. */
  isCurrent(): boolean
  onFailure(error: Error, timedOut: boolean): void
}

function loadTimeoutError(url: string, timeoutMs: number): Error {
  return new Error(`The page did not respond within ${Math.round(timeoutMs / 1000)}s: ${url}`)
}

/** Loads `url`, failing with a timeout error when the load never settles. */
export function loadViewUrlBounded(
  view: WebContentsView,
  url: string,
  handlers: BoundedLoadHandlers,
  timeoutMs: number = PAGE_LOAD_TIMEOUT_MS
): void {
  let settled = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const settle = (): boolean => {
    if (settled) return false
    settled = true
    if (timer) clearTimeout(timer)
    timer = null
    return true
  }

  timer = setTimeout(() => {
    if (!settle()) return
    if (!handlers.isCurrent() || view.webContents.isDestroyed()) return
    view.webContents.stop()
    handlers.onFailure(loadTimeoutError(url, timeoutMs), true)
  }, timeoutMs)

  void view.webContents.loadURL(url).then(
    () => {
      settle()
    },
    (error: Error) => {
      if (!settle()) return
      handlers.onFailure(error, false)
    }
  )
}
