/**
 * IPC handlers for app settings, browsing data, and download path management.
 */

import { app, clipboard, dialog } from 'electron'
import { isValidDownloadPath } from '../validation'
import { SETTINGS_CATEGORIES, validateCategoryValues } from '../../settings/validation'
import { log } from './shared'
import { loadSettings, getSetting, getDownloadPath, SettingsRuntimeApplyError } from '../../settings'
import type { AppSettings } from '../../settings'
import { getMainWindow } from '../../windows/main'
import type { ServiceRegistry } from '../../services'
import {
  settingsApplyContract,
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

function settingsFailure(error: unknown, code: 'SETTINGS_WRITE_FAILED' | 'SETTINGS_RESET_FAILED'): never {
  if (error instanceof SettingsRuntimeApplyError) {
    ipcFailure('RUNTIME_APPLY_FAILED', 'Unable to apply settings', false, error)
  }
  ipcFailure(code, 'Unable to save settings', false, error)
}

export function registerSettingsHandlers(registry: ServiceRegistry): void {
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
      await registry.settingsCoordinator.apply({ storage: { downloadPath: inputPath } })
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
    await registry.settingsCoordinator.apply({ storage: { downloadPath: selectedPath } })
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
    if (typeof category !== 'string' || !(SETTINGS_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error('Invalid settings category')
    }
    if (typeof values !== 'object' || values === null || Array.isArray(values)) {
      throw new Error('Settings values must be a non-null object')
    }
    const validation = validateCategoryValues(category, values)
    if (!validation.valid) {
      throw new Error(`Invalid settings values: ${validation.error}`)
    }
    try {
      await registry.settingsCoordinator.apply({
        [category]: validation.data as Partial<AppSettings[keyof AppSettings]>,
      })
    } catch (error) {
      settingsFailure(error, 'SETTINGS_WRITE_FAILED')
    }
    return { success: true }
  })

  secureContractHandle(settingsApplyContract, async (patch) => {
    try {
      return await registry.settingsCoordinator.apply(patch)
    } catch (error) {
      settingsFailure(error, 'SETTINGS_WRITE_FAILED')
    }
  })

  secureContractHandle(settingsResetContract, async () => {
    try {
      const settings = await registry.settingsCoordinator.reset()
      return { success: true as const, settings }
    } catch (error) {
      settingsFailure(error, 'SETTINGS_RESET_FAILED')
    }
  })
}
