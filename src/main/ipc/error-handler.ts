/**
 * Global IPC error handler.
 * Stores recent error logs for debugging via the ERRORS_GET_RECENT handler.
 */

import { createLogger } from '../../shared/logger'
const log = createLogger('ipc')

interface ErrorLog {
  timestamp: number
  channel: string
  error: string
  stack?: string
}

class IpcErrorHandler {
  private errorLogs: ErrorLog[] = []
  private readonly MAX_LOGS = 100

  /**
   * Logs an error with context information.
   */
  logError(channel: string, error: Error): void {
    const errorLog: ErrorLog = {
      timestamp: Date.now(),
      channel,
      error: error.message,
      stack: error.stack,
    }

    this.errorLogs.push(errorLog)

    // Keep only last MAX_LOGS entries
    if (this.errorLogs.length > this.MAX_LOGS) {
      this.errorLogs.shift()
    }

    // Log to logger with context
    log.error(`[IPC Error] ${channel}: ${error.message}`)
    if (error.stack) {
      log.error(error.stack)
    }
  }

  /**
   * Gets recent error logs (for debugging).
   */
  getRecentErrors(limit = 10): ErrorLog[] {
    return this.errorLogs.slice(-limit)
  }

  /**
   * Clears error log history.
   */
  clearLogs(): void {
    this.errorLogs = []
  }
}

// Singleton instance
export const ipcErrorHandler = new IpcErrorHandler()
