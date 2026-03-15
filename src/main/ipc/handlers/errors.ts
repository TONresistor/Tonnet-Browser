/**
 * IPC handlers for error log retrieval (debugging).
 */

import { IPC_CHANNELS } from '../../../shared/types'
import { ipcErrorHandler } from '../error-handler'
import { secureHandleWithEvent } from './shared'

export function registerErrorHandlers(): void {
  secureHandleWithEvent(IPC_CHANNELS.ERRORS_GET_RECENT, (_event, limit?: number) => {
    return ipcErrorHandler.getRecentErrors(limit)
  })

  secureHandleWithEvent(IPC_CHANNELS.ERRORS_CLEAR, () => {
    ipcErrorHandler.clearLogs()
    return { success: true }
  })
}
