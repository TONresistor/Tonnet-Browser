/**
 * IPC handlers for app settings, browsing data, and download path management.
 */

import { errorMessage } from '../../../shared/errors'
import { app, dialog } from 'electron'
import path from 'path'
import { getAllSessions } from '../../windows/tabs-session'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { isValidDownloadPath } from '../validation'
import { SETTINGS_CATEGORIES, validateCategoryValues } from '../../settings/validation'
import { secureHandle, secureHandleWithEvent, emitToRenderer, log } from './shared'
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
import { onPrivacySettingsChanged, onAppearanceSettingsChanged } from '../../windows/tabs'
import { syncMessengerBridgeNamespaces } from '../../proxy/config-writer'
import { disconnectChatSession } from './chat'
import type { ServiceRegistry } from '../../services'

function getBridgeWorkDir(): string {
  return path.join(app.getPath('userData'), 'bridge')
}

export function registerSettingsHandlers(registry: ServiceRegistry): void {
  const { proxyManager, storageManager, contentFilterManager, walletManager } = registry

  // ===== Clear Browsing Data =====
  secureHandle(IPC_CHANNELS.CLEAR_BROWSING_DATA, async () => {
    const sessions = getAllSessions()
    await Promise.all(
      sessions.map(async (ses) => {
        await ses.clearCache()
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
        })
      })
    )
    log.info(`Browsing data cleared across ${sessions.length} session(s)`)
    return { success: true }
  })

  // ===== Storage Settings Handlers =====
  secureHandle(IPC_CHANNELS.STORAGE_GET_DOWNLOAD_PATH, () => {
    return { success: true, path: getDownloadPath() }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_SET_DOWNLOAD_PATH, (_event, inputPath: string) => {
    // Security: Validate path before setting
    const validation = isValidDownloadPath(inputPath)
    if (!validation.valid) {
      log.warn(`Invalid download path: ${inputPath} - ${validation.error}`)
      return { success: false, error: validation.error }
    }

    try {
      setDownloadPath(inputPath)
      log.info(`Download path set to: ${inputPath}`)
      return { success: true }
    } catch (error) {
      log.error(`Failed to set download path: ${String(error)}`)
      return { success: false, error: errorMessage(error) }
    }
  })

  secureHandle(IPC_CHANNELS.STORAGE_SELECT_DOWNLOAD_FOLDER, async () => {
    const win = getMainWindow()
    if (!win) {
      return { success: false, error: 'No window available' }
    }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select TON Storage Download Folder',
      buttonLabel: 'Select Folder',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const selectedPath = result.filePaths[0]
    setDownloadPath(selectedPath)
    log.info(`Download folder selected: ${selectedPath}`)
    return { success: true, path: selectedPath }
  })

  // ===== App Settings Handlers =====
  secureHandle(IPC_CHANNELS.SETTINGS_GET_ALL, () => {
    return loadSettings()
  })

  secureHandleWithEvent(IPC_CHANNELS.SETTINGS_GET, (_event, category: keyof AppSettings) => {
    // Validate category parameter
    if (typeof category !== 'string' || !(SETTINGS_CATEGORIES as readonly string[]).includes(category)) {
      throw new Error('Invalid settings category')
    }
    return getSetting(category)
  })

  secureHandleWithEvent(IPC_CHANNELS.SETTINGS_SET, async (_event, category: keyof AppSettings, values: object) => {
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
    setSetting(category, validation.data as Partial<AppSettings[keyof AppSettings]>)
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
      onPrivacySettingsChanged()
    }
    // If appearance settings changed, update WebContentsView bounds (for tab orientation)
    if (category === 'appearance') {
      onAppearanceSettingsChanged()
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
        await disconnectChatSession(walletManager.getBridgeClient())
      }
      const changed = syncMessengerBridgeNamespaces(getBridgeWorkDir(), enabled)
      if (changed && proxyManager.isRunning()) {
        try {
          await proxyManager.restartBridge()
        } catch (err) {
          if (previousMessengerNetwork !== undefined) {
            setSetting('messenger', { networkEnabled: previousMessengerNetwork })
            syncMessengerBridgeNamespaces(getBridgeWorkDir(), previousMessengerNetwork)
          }
          log.error('Bridge restart after messenger settings change failed:', err)
          throw err
        }
      }
    }
    emitToRenderer(IPC_CHANNELS.SETTINGS_CHANGED, { category, values })
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.SETTINGS_RESET, () => {
    resetSettings()
    emitToRenderer(IPC_CHANNELS.SETTINGS_CHANGED, { reset: true })

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
    onAppearanceSettingsChanged()
    onPrivacySettingsChanged()
    return { success: true }
  })
}
