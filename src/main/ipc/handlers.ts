/**
 * IPC handlers orchestrator.
 * Delegates to domain-specific sub-modules in ./handlers/.
 */

import { createLogger } from '../../shared/logger'
const log = createLogger('ipc')

import type { ServiceRegistry } from '../services'
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
  registerWalletHandlers,
  registerBridgeHandlers,
  registerTonConnectHandlers,
  registerCocoonHandlers,
  registerChatHandlers,
} from './handlers/index'

// Re-export for use by other modules (e.g. updater.ts, payment-interceptor.ts)
export { secureHandle, emitToRenderer } from './handlers/shared'

// Guard to prevent multiple listener registrations
let handlersRegistered = false

// Test-only: reset the guard to allow re-registration in tests
export function _resetHandlersForTesting(): void {
  handlersRegistered = false
}

export function registerIpcHandlers(registry: ServiceRegistry): void {
  // Prevent duplicate listener registration (causes memory leaks)
  if (handlersRegistered) {
    log.warn('Handlers already registered, skipping duplicate registration')
    return
  }
  handlersRegistered = true

  registerProxyHandlers(registry)
  registerTabsHandlers()
  registerViewsHandlers(registry)
  registerNavigationHandlers()
  registerStorageHandlers(registry)
  registerBookmarkHandlers()
  registerWindowHandlers()
  registerSettingsHandlers(registry)
  registerHistoryHandlers(registry)
  registerWalletHandlers(registry)
  registerBridgeHandlers(registry)
  registerTonConnectHandlers(registry)
  registerCocoonHandlers(registry)
  registerChatHandlers(registry)
}
