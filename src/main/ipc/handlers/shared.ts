/**
 * Shared IPC utilities: security checks, rate limiters, and handler wrappers.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { handleWithErrors } from '../error-handler'
import { RateLimiter } from '../validation'
import { createLogger } from '../../../shared/logger'
import { getMainWindow } from '../../windows/main'

export const log = createLogger('ipc')

// Lenient limits: 30 nav/sec, 10 storage ops/sec
export const navLimiter = new RateLimiter(30, 1000)
export const storageLimiter = new RateLimiter(10, 1000)

/**
 * Security: Verify IPC call originates from the main window, not a compromised tab/WebContentsView
 * This prevents a malicious website from invoking privileged IPC handlers
 */
export function verifyIpcOrigin(event: IpcMainInvokeEvent): void {
  const mainWindow = getMainWindow()
  if (!mainWindow) {
    throw new Error('Main window not available')
  }

  // Check if sender is the main window's webContents (not a WebContentsView)
  if (event.sender !== mainWindow.webContents) {
    log.error('Unauthorized IPC call from non-main-window sender')
    throw new Error('Unauthorized: IPC calls must originate from main window')
  }
}

/**
 * Secure ipcMain.handle wrapper - verifies origin + catches errors
 * All IPC handlers should use this to prevent calls from compromised WebContentsViews
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function secureHandle(channel: string, handler: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      verifyIpcOrigin(event)
      return await handler(...args)
    } catch (err) {
      log.error(`Error in handler '${channel}': ${(err as Error).message}`)
      return { success: false, error: (err as Error).message }
    }
  })
}

/**
 * Secure ipcMain.handle wrapper for handlers that need the event parameter
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function secureHandleWithEvent(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      verifyIpcOrigin(event)
      return await handler(event, ...args)
    } catch (err) {
      log.error(`Error in handler '${channel}': ${(err as Error).message}`)
      return { success: false, error: (err as Error).message }
    }
  })
}

/**
 * Wrapper for handleWithErrors that adds origin verification
 * Use for handlers that need the full error wrapping + origin check
 */
export function handleSecure<T = unknown>(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<T> | T
): void {
  handleWithErrors(channel, async (event, ...args) => {
    verifyIpcOrigin(event)
    return await handler(event, ...args)
  })
}
