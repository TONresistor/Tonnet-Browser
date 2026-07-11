/**
 * IPC handlers for app settings, browsing data, and download path management.
 */

import { errorMessage } from '../../../shared/errors'
import { app, clipboard, dialog } from 'electron'
import path from 'path'
import { isValidDownloadPath } from '../validation'
import { SETTINGS_CATEGORIES, validateCategoryValues } from '../../settings/validation'
import { log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import {
  loadSettings,
  getSetting,
  setSetting,
  resetSettings,
  getDownloadPath,
  setDownloadPath,
  AppSettings,
} from '../../settings'
import { getMainWindow } from '../../windows/main'
import { syncMessengerBridgeNamespaces } from '../../proxy/config-writer'
import type { ServiceRegistry } from '../../services'
import {
  settingsChangedContract,
  settingsGetAllContract,
  settingsGetContract,
  settingsDiagnosticsGetContract,
  settingsDiagnosticsEnableContract,
  settingsDiagnosticsDisableContract,
  settingsDiagnosticsCopyContract,
  settingsResetContract,
  settingsSetContract,
  clearBrowsingDataContract,
} from '../../../shared/ipc-contract/settings'
import {
  diagnosticLoggingStatus,
  disableDiagnosticLogging,
  enableDiagnosticLogging,
  createLogger,
} from '../../../shared/logger'
import {
  storageGetDownloadPathContract,
  storageSelectDownloadFolderContract,
  storageSetDownloadPathContract,
} from '../../../shared/ipc-contract/storage'
import { ipcFailure, secureContractHandle } from '../contract-handler'
import { buildDiagnosticReport } from '../../logging/diagnostic-report'
import { flushNativeLogs } from '../../logging/native-log-router'

function getBridgeWorkDir(): string {
  return path.join(app.getPath('userData'), 'bridge')
}

export function registerSettingsHandlers(registry: ServiceRegistry): void {
  const { proxyManager, storageManager, contentFilterManager, walletManager } = registry

  // ===== Clear Browsing Data =====
  secureContractHandle(clearBrowsingDataContract, async () => {
    const sessions = registry.tabManager.sessions.getAllSessions()
    await Promise.all(
      sessions.map(async (ses) => {
        await ses.clearCache()
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
        })
      })
    )
    log.info(`Browsing data cleared across ${sessions.length} session(s)`)
    return { success: true as const }
  })

  // ===== Storage Settings Handlers =====
  secureContractHandle(storageGetDownloadPathContract, () => {
    return { success: true as const, path: getDownloadPath() }
  })

  secureContractHandle(storageSetDownloadPathContract, async (inputPath) => {
    // Security: Validate path before setting
    const validation = isValidDownloadPath(inputPath)
    if (!validation.valid) {
      log.event('warn', 'settings.download_path.invalid', 'invalid download path rejected', {
        reason: validation.error,
      })
      ipcFailure('INVALID_DOWNLOAD_PATH', 'Invalid download path')
    }

    try {
      await setDownloadPath(inputPath)
      log.event('info', 'settings.download_path.updated', 'download folder updated')
      return { success: true as const }
    } catch (error) {
      ipcFailure('DOWNLOAD_PATH_WRITE_FAILED', 'Unable to save download path', false, error)
    }
  })

  secureContractHandle(storageSelectDownloadFolderContract, async () => {
    const win = getMainWindow()
    if (!win) {
      ipcFailure('WINDOW_UNAVAILABLE', 'No window available')
    }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select TON Storage Download Folder',
      buttonLabel: 'Select Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false as const, canceled: true as const }
    }

    const selectedPath = result.filePaths[0]
    await setDownloadPath(selectedPath)
    log.event('info', 'settings.download_path.selected', 'download folder selected')
    return { success: true as const, path: selectedPath }
  })

  // ===== App Settings Handlers =====
  secureContractHandle(settingsGetAllContract, () => {
    return loadSettings()
  })

  secureContractHandle(settingsGetContract, (category) => {
    // Validate category parameter
    if (typeof category !== 'string' || !(SETTINGS_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error('Invalid settings category')
    }
    return getSetting(category)
  })

  secureContractHandle(settingsDiagnosticsGetContract, () => diagnosticLoggingStatus())
  secureContractHandle(settingsDiagnosticsEnableContract, () => {
    const until = enableDiagnosticLogging()
    createLogger('logging').status('logging.diagnostics.enabled', 'diagnostic logging enabled · 15 min', { until })
    return diagnosticLoggingStatus()
  })
  secureContractHandle(settingsDiagnosticsDisableContract, () => {
    disableDiagnosticLogging()
    createLogger('logging').status('logging.diagnostics.disabled', 'diagnostic logging disabled')
    return diagnosticLoggingStatus()
  })
  secureContractHandle(settingsDiagnosticsCopyContract, async () => {
    await flushNativeLogs()
    const report = await buildDiagnosticReport(app.getPath('logs'), {
      appVersion: app.getVersion(),
      diagnosticLogging: diagnosticLoggingStatus(),
    })
    clipboard.writeText(report)
    createLogger('logging').event('info', 'logging.diagnostics.copied', 'diagnostic report copied')
    return { success: true as const }
  })

  secureContractHandle(settingsSetContract, async (category, values) => {
    // Validate category parameter
    if (typeof category !== 'string' || !(SETTINGS_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error('Invalid settings category')
    }
    // Validate values parameter
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new Error('Settings values must be a non-null object')
    }
    // Validate values with Zod schema for this category
    const validation = validateCategoryValues(category, values)
    if (!validation.valid) {
      throw new Error(`Invalid settings values: ${validation.error}`)
    }
    const previousMessengerNetwork =
      category === 'messenger' && 'networkEnabled' in validation.data
        ? getSetting('messenger').networkEnabled
        : undefined
    await setSetting(category, validation.data as Partial<AppSettings[keyof AppSettings]>)
    // If network settings changed, check if proxy needs restart (non-blocking)
    if (category === 'network' && proxyManager.isRunning()) {
      proxyManager.applySettingsChange().catch((err) => {
        log.error('Proxy restart after settings change failed:', err)
      })
    }
    // If resolver-related general settings changed, check if proxy needs restart (non-blocking)
    if (
      category === 'general' &&
      proxyManager.isRunning() &&
      ('resolveEth' in values || 'ethRpc' in values || 'resolveSol' in values || 'solRpc' in values)
    ) {
      proxyManager.applySettingsChange().catch((err) => {
        log.error('Proxy restart after settings change failed:', err)
      })
    }
    // If privacy settings changed, restart cookie auto-delete timer
    if (category === 'privacy') {
      registry.tabManager.sessions.onPrivacySettingsChanged()
    }
    // If appearance settings changed, update WebContentsView bounds (for tab orientation)
    if (category === 'appearance') {
      registry.tabManager.onAppearanceSettingsChanged()
    }
    // If content filtering settings changed, apply immediately to filter manager
    if (category === 'contentFiltering') {
      contentFilterManager.applySettings(getSetting('contentFiltering'))
    }
    // If storage seedingEnabled changed, resume seeding on completed bags
    if (category === 'storage' && 'seedingEnabled' in values) {
      const storageSettings = getSetting('storage')
      if (storageSettings.seedingEnabled) {
        storageManager.resumeSeeding()
      }
    }
    // If wallet settings changed, update auto-lock timer
    if (category === 'wallet') {
      const walletSettings = getSetting('wallet')
      walletManager.setAutoLockMinutes(walletSettings.autoLockMinutes)
    }
    if (category === 'messenger' && 'networkEnabled' in validation.data) {
      const enabled = Boolean((validation.data as { networkEnabled?: boolean }).networkEnabled)
      if (!enabled) {
        await registry.chatSessionController.disconnect()
      }
      const changed = await syncMessengerBridgeNamespaces(getBridgeWorkDir(), enabled)
      if (changed && proxyManager.isRunning()) {
        try {
          await proxyManager.restartBridge()
        } catch (err) {
          if (previousMessengerNetwork !== undefined) {
            await setSetting('messenger', { networkEnabled: previousMessengerNetwork })
            await syncMessengerBridgeNamespaces(getBridgeWorkDir(), previousMessengerNetwork)
          }
          log.error('Bridge restart after messenger settings change failed:', err)
          throw err
        }
      }
    }
    emitContractToRenderer(settingsChangedContract, { category, values })
    return { success: true }
  })

  secureContractHandle(settingsResetContract, async () => {
    await resetSettings()
    emitContractToRenderer(settingsChangedContract, { reset: true })

    // Re-apply runtime state for every category that SETTINGS_SET also re-applies,
    // otherwise live services keep the pre-reset config until an app restart.
    if (proxyManager.isRunning()) {
      proxyManager.applySettingsChange().catch((err) => {
        log.error('Proxy restart after reset failed:', err)
      })
    }
    const walletSettings = getSetting('wallet')
    walletManager.setAutoLockMinutes(walletSettings.autoLockMinutes)
    contentFilterManager.applySettings(getSetting('contentFiltering'))
    const storageSettings = getSetting('storage')
    if (storageSettings.seedingEnabled) {
      storageManager.resumeSeeding()
    }
    void registry.chatSessionController.disconnect().catch((err) => {
      log.warn(`Failed to disconnect chat after settings reset: ${errorMessage(err)}`)
    })
    const messengerBridgeChanged = await syncMessengerBridgeNamespaces(getBridgeWorkDir(), false)
    if (messengerBridgeChanged && proxyManager.isRunning()) {
      proxyManager.restartBridge().catch((err) => {
        log.error('Bridge restart after settings reset failed:', err)
      })
    }
    registry.tabManager.onAppearanceSettingsChanged()
    registry.tabManager.sessions.onPrivacySettingsChanged()
    return { success: true }
  })
}
