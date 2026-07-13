import type { BrowserWindow } from 'electron'
import type { IDisposable } from '../utils/disposable'
import type { OverlayManager } from './overlay-manager'
import type { TabManager, TabManagerDeps } from './tabs'
import { setupMainContextMenu } from './main-context-menu'

export interface WindowScopeDeps {
  overlayManager: OverlayManager
  tabManager: TabManager
  tabDeps: TabManagerDeps
}

export function attachWindowScope(window: BrowserWindow, proxyPort: number, deps: WindowScopeDeps): IDisposable {
  let disposed = false
  deps.overlayManager.attachWindow(window)
  deps.tabManager.attachWindow(window, proxyPort, deps.tabDeps)
  const contextMenu = setupMainContextMenu(window, deps.overlayManager)

  const scope: IDisposable = {
    dispose(): void {
      if (disposed) return
      disposed = true
      window.off('closed', onClosed)
      try {
        deps.tabManager.detachWindow(window)
      } finally {
        try {
          deps.overlayManager.detachWindow(window)
        } finally {
          contextMenu.dispose()
        }
      }
    },
  }
  const onClosed = (): void => scope.dispose()
  window.once('closed', onClosed)
  return scope
}
