import type { BrowserWindow, WebContentsView } from 'electron'
import type { IDisposable } from '../utils/disposable'
import { onWebContents } from '../utils/disposable'
import { createLogger } from '../../shared/logger'
import { updateViewBounds } from './tabs-bounds'

const log = createLogger('tabs')
const MIN_HOLD_MS = 150
const MAX_WAIT_MS = 5000

interface AttachManager {
  readonly window: BrowserWindow | null
  readonly sidebarWidth: number
  readonly views: {
    readonly activeViewId: string | null
    get(tabId: string): WebContentsView | null
  }
  captureWindowGeneration(): number
  ownsWindowGeneration(generation: number): boolean
}

export function setupNavAwareAttach(manager: AttachManager, view: WebContentsView, tabId: string): IDisposable {
  return onWebContents(
    view.webContents,
    'did-start-navigation',
    (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      const { url, isSameDocument, isMainFrame } = details
      if (!isMainFrame || isSameDocument) return
      if (!url || !(url.startsWith('http:') || url.startsWith('https:'))) return
      if (!manager.window || manager.views.get(tabId) !== view || manager.views.activeViewId !== tabId) return
      try {
        if (manager.window.contentView.children.includes(view)) {
          manager.window.contentView.removeChildView(view)
          attachViewWhenReady(manager, view, tabId, manager.captureWindowGeneration())
        }
      } catch (error) {
        log.debug(`did-start-navigation detach failed for tab ${tabId}:`, error)
      }
    }
  )
}

export function attachViewWhenReady(
  manager: AttachManager,
  view: WebContentsView,
  tabId: string,
  generation: number
): void {
  if (!manager.window) return
  const startedAt = Date.now()
  let decided = false

  const performAttach = (): void => {
    if (!manager.ownsWindowGeneration(generation) || !manager.window) return
    if (manager.views.get(tabId) !== view) return
    const webContents = view.webContents
    if (!webContents || webContents.isDestroyed() || manager.views.activeViewId !== tabId) return
    try {
      if (!manager.window.contentView.children.includes(view)) {
        manager.window.contentView.addChildView(view)
        updateViewBounds(view, manager.window, manager.sidebarWidth)
      }
    } catch (error) {
      log.debug(`Deferred attach failed for tab ${tabId}:`, error)
    }
  }

  const decide = (): void => {
    if (decided) return
    decided = true
    const delay = Math.max(0, MIN_HOLD_MS - (Date.now() - startedAt))
    if (delay === 0) performAttach()
    else setTimeout(performAttach, delay)
  }

  view.webContents.once('dom-ready', decide)
  view.webContents.once('did-fail-load', decide)
  setTimeout(decide, MAX_WAIT_MS)
}
