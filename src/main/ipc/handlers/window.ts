/**
 * IPC handlers for window management (minimize, maximize, close, sidebar).
 */

import { getMainWindow } from '../../windows/main'
import type { ServiceRegistry } from '../../services'
import {
  sidebarWidthContract,
  walletSidebarWidthContract,
  windowCloseContract,
  windowMaximizeContract,
  windowMinimizeContract,
} from '../../../shared/ipc-contract/window'
import { secureContractHandle } from '../contract-handler'

export function registerWindowHandlers(registry: ServiceRegistry): void {
  secureContractHandle(windowMinimizeContract, () => {
    const win = getMainWindow()
    win?.minimize()
  })

  secureContractHandle(windowMaximizeContract, () => {
    const win = getMainWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  secureContractHandle(windowCloseContract, () => {
    const win = getMainWindow()
    win?.close()
  })

  // Immediate sidebar width update (for real-time resize)
  secureContractHandle(sidebarWidthContract, (width) => {
    registry.tabManager.updateSidebarWidth(width)
    return { success: true }
  })

  secureContractHandle(walletSidebarWidthContract, (width) => {
    registry.tabManager.updateWalletSidebarWidth(width)
    return { success: true }
  })
}
