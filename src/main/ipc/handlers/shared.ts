/**
 * Shared IPC utilities: security checks, rate limiters, and handler wrappers.
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { ipcErrorHandler } from '../error-handler'
import { createLogger } from '../../../shared/logger'
import { getMainWindow } from '../../windows/main'
import type { IpcFailure } from '../../../shared/ipc-failure'
import type { IDisposable } from '../../utils/disposable'

export const log = createLogger('ipc')

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
 * Error envelope a secureHandle wrapper returns when its handler throws.
 * Renderer callers unwrap it via getIpcError (IPC error-envelope invariant).
 */
export class IpcBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly internalCause?: unknown
  ) {
    super(message)
    this.name = 'IpcBoundaryError'
  }
}

function toIpcFailure(reason: unknown): IpcFailure {
  if (reason instanceof IpcBoundaryError) {
    return { ok: false, error: { code: reason.code, message: reason.message, retryable: reason.retryable } }
  }
  return { ok: false, error: { code: 'IPC_INTERNAL_ERROR', message: 'Operation failed', retryable: false } }
}

function logBoundaryError(channel: string, reason: unknown): void {
  const internal = reason instanceof IpcBoundaryError && reason.internalCause ? reason.internalCause : reason
  ipcErrorHandler.logError(channel, toError(internal))
}

/**
 * Secure ipcMain.handle wrapper - verifies origin + catches errors + logs to IpcErrorHandler
 * All IPC handlers should use this to prevent calls from compromised WebContentsViews.
 * The registered response is `TResult` on success or a stable `IpcFailure` on throw.
 */
export function secureHandle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult | Promise<TResult>
): IDisposable {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<TResult | IpcFailure> => {
    try {
      verifyIpcOrigin(event)
      return await handler(...(args as TArgs))
    } catch (err) {
      logBoundaryError(channel, err)
      return toIpcFailure(err)
    }
  })
  return { dispose: () => ipcMain.removeHandler(channel) }
}

/**
 * Secure ipcMain.handle wrapper for handlers that need the event parameter
 */

export function secureHandleWithEvent<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): IDisposable {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<TResult | IpcFailure> => {
    try {
      verifyIpcOrigin(event)
      return await handler(event, ...(args as TArgs))
    } catch (err) {
      logBoundaryError(channel, err)
      return toIpcFailure(err)
    }
  })
  return { dispose: () => ipcMain.removeHandler(channel) }
}

/** IPC adapter for a WebContentsView whose ownership is verified by its manager. */
export function overlayHandle<TArgs extends unknown[], TResult>(
  channel: string,
  isAuthorized: (event: IpcMainInvokeEvent) => boolean,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): IDisposable {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<TResult | IpcFailure> => {
    try {
      if (!isAuthorized(event)) throw new Error('Unauthorized: IPC call must originate from an owned overlay')
      return await handler(event, ...(args as TArgs))
    } catch (err) {
      logBoundaryError(channel, err)
      return toIpcFailure(err)
    }
  })
  return { dispose: () => ipcMain.removeHandler(channel) }
}

/**
 * IPC handler for tonsite WebContentsViews (NOT the main window).
 * Extracts domain from sender URL. Rejects calls from the main renderer.
 */
export function tonsiteHandle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (domain: string, event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): IDisposable {
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
      return await handler(hostname, event, ...(args as TArgs))
    } catch (err) {
      logBoundaryError(channel, err)
      return toIpcFailure(err)
    }
  })
  return { dispose: () => ipcMain.removeHandler(channel) }
}
