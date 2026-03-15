/**
 * Global IPC error handling wrapper.
 * Catches unhandled errors, logs them uniformly, and returns consistent error responses.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
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

  /**
   * Wraps an IPC handler with error catching and logging.
   * Returns consistent error format: { success: false, error: string }
   */
  private wrapHandler<T = unknown>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T
  ): (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T | { success: false; error: string }> {
    return async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      try {
        const result = await handler(event, ...args)
        return result
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        this.logError(channel, err)

        // Return standardized error response
        return {
          success: false,
          error: err.message,
        }
      }
    }
  }

  /**
   * Registers a handler with automatic error wrapping.
   */
  handle<T = unknown>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T
  ): void {
    ipcMain.handle(channel, this.wrapHandler(channel, handler))
  }
}

// Singleton instance
export const ipcErrorHandler = new IpcErrorHandler()

/**
 * Convenience function to register IPC handlers with error handling.
 * Usage: handleWithErrors('channel:name', async (event, arg1, arg2) => { ... })
 */
export function handleWithErrors<T = unknown>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<T> | T
): void {
  ipcErrorHandler.handle(channel, handler)
}
