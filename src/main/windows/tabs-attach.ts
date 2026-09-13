import type { BrowserWindow, WebContentsView } from 'electron'
import { createLogger } from '../../shared/logger'
import { updateViewBounds } from './tabs-bounds'

const log = createLogger('tabs')

interface AttachManager {
  readonly window: BrowserWindow | null
  readonly sidebarWidth: number
  readonly views: {
    readonly activeViewId: string | null
    get(tabId: string): WebContentsView | null
  }
  ownsWindowGeneration(generation: number): boolean
  captureNavigation(tabId: string, view: WebContentsView): () => boolean
}

export function attachActiveView(
  manager: AttachManager,
  view: WebContentsView,
  tabId: string,
  generation: number
): void {
  if (!manager.window) return
  const isCurrent = manager.captureNavigation(tabId, view)
  if (!isCurrent() || !manager.ownsWindowGeneration(generation)) return
  if (manager.views.get(tabId) !== view) return
  const webContents = view.webContents
  if (!webContents || webContents.isDestroyed() || manager.views.activeViewId !== tabId) return
  try {
    if (!manager.window.contentView.children.includes(view)) {
      manager.window.contentView.addChildView(view)
      updateViewBounds(view, manager.window, manager.sidebarWidth)
    }
  } catch (error) {
    log.debug(`Attach failed for tab ${tabId}:`, error)
  }
}
