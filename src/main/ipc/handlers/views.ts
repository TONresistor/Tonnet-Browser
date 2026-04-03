/**
 * IPC handlers for view visibility management.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandle, emitToRenderer, log } from './shared'
import { hideAllViews, showActiveView } from '../../windows/tabs'
import type { ServiceRegistry } from '../../services'

export function registerViewsHandlers(registry: ServiceRegistry): void {
  const { overlayManager } = registry

  // Overlay action forwarding (from overlay views to main renderer)
  // Cannot use secureHandle because sender is an overlay WebContentsView, not main window
  ipcMain.handle('overlay:action', (event: IpcMainInvokeEvent, actionType: string, actionData: unknown) => {
    if (!overlayManager.isOverlayView(event.sender)) {
      log.error('Unauthorized overlay:action from non-overlay sender')
      return
    }
    // Try main-process handler first (for context menus that execute webContents methods)
    if (overlayManager.handleAction(event.sender, actionType, actionData)) {
      return
    }
    // Fall back to forwarding to renderer
    const overlayId = overlayManager.getOverlayId(event.sender)
    if (overlayId) {
      emitToRenderer('overlay:action', overlayId, actionType, actionData)
    }
  })
  secureHandle(IPC_CHANNELS.VIEW_HIDE, () => {
    hideAllViews()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.VIEW_SHOW, () => {
    showActiveView()
    return { success: true }
  })

  secureHandle(
    IPC_CHANNELS.OVERLAY_SHOW,
    (
      id: string,
      bounds: { x: number; y: number; width: number; height: number },
      content: { type: string; [key: string]: unknown },
      options?: { autoDismiss?: boolean }
    ) => {
      overlayManager.show(id, bounds, content, undefined, options)
      return { success: true }
    }
  )

  secureHandle(IPC_CHANNELS.OVERLAY_HIDE, (id: string) => {
    overlayManager.hide(id)
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.OVERLAY_HIDE_ALL, () => {
    overlayManager.hideAll()
    return { success: true }
  })

  secureHandle(
    IPC_CHANNELS.OVERLAY_UPDATE_BOUNDS,
    (id: string, bounds: { x: number; y: number; width: number; height: number }) => {
      overlayManager.updateBounds(id, bounds)
      return { success: true }
    }
  )
}
