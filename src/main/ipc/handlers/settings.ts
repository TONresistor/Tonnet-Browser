/**
 * IPC handlers for app settings, browsing data, and download path management.
 */

import { session, dialog } from 'electron'
import { SESSION_PARTITION } from '../../windows/constants'
import { IPC_CHANNELS } from '../../../shared/types'
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
import type { ServiceRegistry } from '../../services'

export function registerSettingsHandlers(registry: ServiceRegistry): void {
  const { proxyManager, storageManager, contentFilterManager, walletManager } = registry

  // ===== Clear Browsing Data =====
  secureHandle(IPC_CHANNELS.CLEAR_BROWSING_DATA, async () => {
    const ses = session.fromPartition(SESSION_PARTITION)
    await ses.clearCache()
    await ses.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage'],
    })
    log.info('Browsing data cleared')
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
      // Update the storage manager with new path
      storageManager.setStoragePath(inputPath)
      log.info(`Download path set to: ${inputPath}`)
      return { success: true }
    } catch (error) {
      log.error(`Failed to set download path: ${String(error)}`)
      return { success: false, error: (error as Error).message }
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
    storageManager.setStoragePath(selectedPath)
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
    setSetting(category, validation.data as Partial<AppSettings[keyof AppSettings]>)
    // Notify renderer of settings change
    emitToRenderer('settings:changed', { category, values })
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
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.SETTINGS_RESET, () => {
    resetSettings()
    emitToRenderer('settings:changed', { reset: true })
    // Restart cookie auto-delete timer with default settings
    onPrivacySettingsChanged()
    return { success: true }
  })
}
