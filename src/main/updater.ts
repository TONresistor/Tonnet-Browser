/**
 * Manual update checker using electron-updater.
 * Exposes IPC handlers for check, download, and install.
 * No auto-check — only triggered by user action in Settings > About.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { IPC_CHANNELS } from '../shared/types'
import { logger } from '../shared/logger'

let mainWindow: BrowserWindow | null = null

export function initUpdater(win: BrowserWindow): void {
  mainWindow = win

  // Manual flow only — no auto-download, no install on quit
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  // Forward updater events to renderer
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:downloaded')
  })

  autoUpdater.on('error', (error) => {
    logger.error('Updater', `Update error: ${error.message}`)
    mainWindow?.webContents.send('updater:error', error.message)
  })

  // IPC handlers
  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
    if (!app.isPackaged) {
      return { updateAvailable: false, reason: 'dev-mode' }
    }
    const result = await autoUpdater.checkForUpdates()
    if (!result) {
      return { updateAvailable: false }
    }
    return {
      updateAvailable: result.updateInfo.version !== app.getVersion(),
      version: result.updateInfo.version,
      releaseDate: result.updateInfo.releaseDate,
    }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, async () => {
    await autoUpdater.downloadUpdate()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.UPDATER_INSTALL, () => {
    autoUpdater.quitAndInstall()
  })

  logger.info('Updater', 'Manual update checker initialized')
}
