/**
 * Global IPC error handler.
 * Mirrors handler errors to the structured logger with channel context.
 */

import { createLogger } from '../../shared/logger'
const log = createLogger('ipc')

class IpcErrorHandler {
  /**
   * Logs an error with context information.
   */
  logError(channel: string, error: Error): void {
    log.error(`[IPC Error] ${channel}: ${error.message}`)
    if (error.stack) {
      log.error(error.stack)
    }
  }
}

// Singleton instance
export const ipcErrorHandler = new IpcErrorHandler()
