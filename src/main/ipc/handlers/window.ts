/**
 * IPC handlers for window management (minimize, maximize, close, sidebar).
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { secureHandle, secureHandleWithEvent } from './shared'
import { getMainWindow } from '../../windows/main'
import { updateSidebarWidth, updateWalletSidebarWidth } from '../../windows/tabs'

export function registerWindowHandlers(): void {
  secureHandle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = getMainWindow()
    win?.minimize()
  })

  secureHandle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow()
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  secureHandle(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = getMainWindow()
    win?.close()
  })

  // Immediate sidebar width update (for real-time resize)
  secureHandleWithEvent(IPC_CHANNELS.UPDATE_SIDEBAR_WIDTH, (_event, width: number) => {
    // Validate width parameter
    if (typeof width !== 'number' || width < 0 || width > 3000 || !isFinite(width)) {
      return { success: false, error: 'Invalid width parameter' }
    }
    updateSidebarWidth(width)
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.UPDATE_WALLET_SIDEBAR_WIDTH, (width: number) => {
    updateWalletSidebarWidth(typeof width === 'number' ? width : 0)
    return { success: true }
  })
}
