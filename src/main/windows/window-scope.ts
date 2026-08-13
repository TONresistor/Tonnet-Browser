import type { BrowserWindow } from 'electron'
import { onWebContents, type IDisposable } from '../utils/disposable'
import type { OverlayManager } from './overlay-manager'
import type { TabManager, TabManagerDeps } from './tabs'
import { setupMainContextMenu } from './main-context-menu'
import { handleDevToolsShortcut, resolveDevToolsTarget, type WebContentsInputHandler } from './devtools'

export interface WindowScopeDeps {
  overlayManager: OverlayManager
  tabManager: TabManager
  tabDeps: TabManagerDeps
}

export function attachWindowScope(window: BrowserWindow, proxyPort: number, deps: WindowScopeDeps): IDisposable {
  let disposed = false
  const handleInput: WebContentsInputHandler = (event, input) => {
    if (deps.tabManager.pageZoom.handleInput(input)) {
      event.preventDefault()
      return
    }
    handleDevToolsShortcut(event, input, () => resolveDevToolsTarget(window, deps.tabManager.getActiveView()))
  }

  deps.overlayManager.attachWindow(window, handleInput)
  deps.tabManager.attachWindow(window, proxyPort, deps.tabDeps)
  const inputListener = onWebContents(window.webContents, 'before-input-event', handleInput)
  const contextMenu = setupMainContextMenu(window, deps.overlayManager)

  const scope: IDisposable = {
    dispose(): void {
      if (disposed) return
      disposed = true
      window.off('closed', onClosed)
      inputListener.dispose()
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
