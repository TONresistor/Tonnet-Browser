/**
 * Shared IPC utilities: security checks, rate limiters, and handler wrappers.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { ipcErrorHandler } from '../error-handler'
import { RateLimiter } from '../validation'
import { createLogger } from '../../../shared/logger'
import { getMainWindow } from '../../windows/main'

export const log = createLogger('ipc')

// Lenient limits: 30 nav/sec, 10 storage ops/sec
export const navLimiter = new RateLimiter(30, 1000)
export const storageLimiter = new RateLimiter(10, 1000)

/**
 * Send a message to the renderer process via the main window.
 * Replaces the pattern: const win = getMainWindow(); if (win) win.webContents.send(...)
 */
export function emitToRenderer(channel: string, ...args: unknown[]): void {
  const win = getMainWindow()
  if (win) win.webContents.send(channel, ...args)
}

/**
 * Normalize an unknown value (typically a caught error or a rejected Promise
 * reason) into a proper Error. `null` and `undefined` get a descriptive message
 * instead of the misleading "null" / "undefined" strings.
 */
export function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  if (reason == null) return new Error('Unknown error')
  return new Error(String(reason))
}

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
 * Secure ipcMain.handle wrapper - verifies origin + catches errors + logs to IpcErrorHandler
 * All IPC handlers should use this to prevent calls from compromised WebContentsViews
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function secureHandle(channel: string, handler: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      verifyIpcOrigin(event)
      return await handler(...args)
    } catch (err) {
      const error = toError(err)
      ipcErrorHandler.logError(channel, error)
      return { success: false, error: error.message }
    }
  })
}

/**
 * Secure ipcMain.handle wrapper for handlers that need the event parameter
 */

export function secureHandleWithEvent(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      verifyIpcOrigin(event)
      return await handler(event, ...args)
    } catch (err) {
      const error = toError(err)
      ipcErrorHandler.logError(channel, error)
      return { success: false, error: error.message }
    }
  })
}

/**
 * IPC handler for tonsite WebContentsViews (NOT the main window).
 * Extracts domain from sender URL. Rejects calls from the main renderer.
 */
export function tonsiteHandle(
  channel: string,
  handler: (domain: string, event: IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const mainWindow = getMainWindow()
      if (mainWindow && event.sender === mainWindow.webContents) {
        throw new Error('Unauthorized: this channel is for tonsites only')
      }
      const url = event.sender.getURL()
      let hostname: string
      try {
        hostname = new URL(url).hostname
      } catch {
        hostname = ''
      }
      if (!hostname) hostname = 'local'
      return await handler(hostname, event, ...args)
    } catch (err) {
      const error = toError(err)
      ipcErrorHandler.logError(channel, error)
      return { success: false, error: error.message }
    }
  })
}
