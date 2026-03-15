/**
 * IPC handlers for view visibility management.
 */

import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandle } from './shared'
import { hideAllViews, showActiveView } from '../../windows/tabs'

export function registerViewsHandlers(): void {
  secureHandle(IPC_CHANNELS.VIEW_HIDE, () => {
    hideAllViews()
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.VIEW_SHOW, () => {
    showActiveView()
    return { success: true }
  })
}
