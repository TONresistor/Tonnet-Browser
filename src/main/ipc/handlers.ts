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
import { withIpcRegistrationScope } from './contract-handler'
import { initUpdater } from '../updater'

// Re-export for use by other modules.
export { secureHandle } from './handlers/shared'

// Guard to prevent multiple listener registrations
let registeredScopes = new WeakSet<object>()

// Test-only: reset the guard to allow re-registration in tests
export function _resetHandlersForTesting(): void {
  registeredScopes = new WeakSet<object>()
}

export function registerIpcHandlers(registry: ServiceRegistry): void {
  // Prevent duplicate listener registration (causes memory leaks)
  if (registeredScopes.has(registry.ipcRegistrations)) {
    log.warn('Handlers already registered, skipping duplicate registration')
    return
  }
  registeredScopes.add(registry.ipcRegistrations)

  withIpcRegistrationScope(registry.ipcRegistrations, () => {
    registerProxyHandlers(registry)
    registerTabsHandlers(registry.tabManager)
    registerViewsHandlers(registry)
    registerNavigationHandlers(registry.tabManager)
    registerStorageHandlers(registry)
    registerBookmarkHandlers()
    registerWindowHandlers(registry)
    registerSettingsHandlers(registry)
    registerHistoryHandlers(registry)
    registerWalletHandlers(registry)
    registerBridgeHandlers(registry)
    registerTonConnectHandlers(registry)
    registerCocoonHandlers(registry)
    registerChatHandlers(registry)
    initUpdater()
  })
}
