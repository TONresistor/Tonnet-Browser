/**
 * IPC handlers for view visibility management.
 */

import { emitContractToRenderer } from '../../events/renderer-events'
import type { ServiceRegistry } from '../../services'
import { viewHideContract, viewShowContract } from '../../../shared/ipc-contract/browsing'
import { overlayContractHandle, secureContractHandle } from '../contract-handler'
import {
  overlayHideAllContract,
  overlayHideContract,
  overlayShowContract,
  overlayUpdateBoundsContract,
  overlayActionEventContract,
  overlayActionRequestContract,
} from '../../../shared/ipc-contract/overlay'

export function registerViewsHandlers(registry: ServiceRegistry): void {
  const { overlayManager } = registry

  // Overlay action forwarding (from overlay views to main renderer)
  overlayContractHandle(
    overlayActionRequestContract,
    (event) => overlayManager.isOverlayView(event.sender),
    (event, actionType, actionData) => {
      // Try main-process handler first (for context menus that execute webContents methods)
      if (overlayManager.handleAction(event.sender, actionType, actionData)) {
        return
      }
      // Fall back to forwarding to renderer
      const overlayId = overlayManager.getOverlayId(event.sender)
      if (overlayId) {
        emitContractToRenderer(overlayActionEventContract, overlayId, actionType, actionData)
      }
    }
  )
  secureContractHandle(viewHideContract, () => {
    registry.tabManager.hideAllViews()
    return { success: true }
  })

  secureContractHandle(viewShowContract, () => {
    registry.tabManager.showActiveView()
    return { success: true }
  })

  secureContractHandle(overlayShowContract, (id, bounds, content, options?: { autoDismiss?: boolean }) => {
    overlayManager.show(id, bounds, content, undefined, options)
    return { success: true as const }
  })

  secureContractHandle(overlayHideContract, (id) => {
    overlayManager.hide(id)
    return { success: true as const }
  })

  secureContractHandle(overlayHideAllContract, () => {
    overlayManager.hideAll()
    return { success: true as const }
  })

  secureContractHandle(overlayUpdateBoundsContract, (id, bounds) => {
    overlayManager.updateBounds(id, bounds)
    return { success: true as const }
  })
}
