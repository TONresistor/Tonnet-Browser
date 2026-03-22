/**
 * IPC handlers orchestrator.
 * Delegates to domain-specific sub-modules in ./handlers/.
 */

import { createLogger } from '../../shared/logger'
const log = createLogger('ipc')

import {
  registerProxyHandlers,
  registerTabsHandlers,
  registerViewsHandlers,
  registerNavigationHandlers,
  registerStorageHandlers,
  registerBookmarkHandlers,
  registerWindowHandlers,
  registerSettingsHandlers,
  registerHistoryHandlers,
  registerErrorHandlers,
  registerWalletHandlers,
} from './handlers/index'

// Re-export secureHandle for use by other modules (e.g. updater.ts)
export { secureHandle } from './handlers/shared'

// Guard to prevent multiple listener registrations
let handlersRegistered = false

// Test-only: reset the guard to allow re-registration in tests
export function _resetHandlersForTesting(): void {
  handlersRegistered = false
}

export function registerIpcHandlers(): void {
  // Prevent duplicate listener registration (causes memory leaks)
  if (handlersRegistered) {
    log.warn('Handlers already registered, skipping duplicate registration')
    return
  }
  handlersRegistered = true

  registerProxyHandlers()
  registerTabsHandlers()
  registerViewsHandlers()
  registerNavigationHandlers()
  registerStorageHandlers()
  registerBookmarkHandlers()
  registerWindowHandlers()
  registerSettingsHandlers()
  registerHistoryHandlers()
  registerErrorHandlers()
  registerWalletHandlers()
}
