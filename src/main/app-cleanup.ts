/**
 * App-exit cleanup. Extracted from index.ts (OPP-65).
 *
 * Clears browsing data/traces on exit when the user enabled clearOnExit, then
 * tears down tab views and services. Guarded against re-entry so the
 * window-all-closed and before-quit paths can both invoke it safely.
 */
import log from '../shared/logger'
import { getSetting, loadSettings, saveSettings } from './settings'
import { getAllSessions, cleanupTabManager } from './windows/tabs'
import { destroyServices, type ServiceRegistry } from './services'

let isCleaningUp = false

/** True once runCleanup has started, so callers can avoid racing it. */
export function isCleanupInProgress(): boolean {
  return isCleaningUp
}

export async function runCleanup(services: ServiceRegistry): Promise<void> {
  if (isCleaningUp) return
  isCleaningUp = true

  // Clear browsing data on exit if enabled
  const { clearOnExit } = getSetting('privacy')
  if (clearOnExit) {
    log.info('Clearing browsing data on exit...')
    try {
      const sessions = getAllSessions()

      for (const ses of sessions) {
        await ses.clearCache()
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
        })
      }

      log.info(`Cleared browsing data for ${sessions.length} session(s)`)
    } catch (error) {
      log.error(`Failed to clear browsing data: ${String(error)}`)
    }

    // Clear bookmarks file (privacy: leave no browsing trace)
    try {
      const { getBookmarksFile } = await import('./bookmarks')
      const { unlinkSync, existsSync } = await import('fs')
      const file = getBookmarksFile()
      if (existsSync(file)) {
        unlinkSync(file)
        log.info('Cleared bookmarks file')
      }
    } catch (error) {
      log.error(`Failed to clear bookmarks: ${String(error)}`)
    }

    // Clear domain lists passively accumulated from prompts (permissions,
    // payment policies). User-configured preferences stay untouched.
    try {
      const settings = loadSettings()
      const hasTraces =
        settings.bridge.permissions.length > 0 ||
        settings.wallet.sitePolicies.length > 0 ||
        settings.wallet.autoPayDomains.length > 0
      if (hasTraces) {
        settings.bridge.permissions = []
        settings.wallet.sitePolicies = []
        settings.wallet.autoPayDomains = []
        saveSettings(settings)
        log.info('Cleared browsing traces from settings file')
      }
    } catch (error) {
      log.error(`Failed to clear browsing traces from settings: ${String(error)}`)
    }
  }

  cleanupTabManager()
  await destroyServices(services)
}
