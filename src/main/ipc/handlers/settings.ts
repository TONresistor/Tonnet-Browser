/**
 * IPC handlers for app settings, browsing data, and download path management.
 */

import { session, dialog } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { isValidDownloadPath } from '../validation'
import { SETTINGS_CATEGORIES, validateCategoryValues } from '../../settings/validation'
import { secureHandle, secureHandleWithEvent, handleSecure, log } from './shared'
import {
  loadSettings,
  getSetting,
  setSetting,
  resetSettings,
  getDownloadPath,
  setDownloadPath,
  AppSettings,
} from '../../settings'
import { proxyManager } from '../../proxy/manager'
import { storageManager } from '../../storage/daemon'
import { contentFilterManager } from '../../content-filter/filter-manager'
import { getMainWindow } from '../../windows/main'
import { onPrivacySettingsChanged, onAppearanceSettingsChanged } from '../../windows/tabs'

export function registerSettingsHandlers(): void {
  // ===== Clear Browsing Data =====
  handleSecure(IPC_CHANNELS.CLEAR_BROWSING_DATA, async () => {
    const ses = session.fromPartition('persist:ton-browser')
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
    setSetting(category, validation.data as any)
    // Notify renderer of settings change
    const win = getMainWindow()
    if (win) {
      win.webContents.send('settings:changed', { category, values })
    }
    // If network settings changed, check if proxy needs restart
    if (category === 'network' && proxyManager.isRunning()) {
      await proxyManager.applySettingsChange()
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
    return { success: true }
  })

  secureHandle(IPC_CHANNELS.SETTINGS_RESET, () => {
    resetSettings()
    const win = getMainWindow()
    if (win) {
      win.webContents.send('settings:changed', { reset: true })
    }
    // Restart cookie auto-delete timer with default settings
    onPrivacySettingsChanged()
    return { success: true }
  })
}
