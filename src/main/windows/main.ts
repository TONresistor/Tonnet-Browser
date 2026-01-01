/**
 * Main window reference.
 * Stores and provides access to the main BrowserWindow.
 */

import { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
