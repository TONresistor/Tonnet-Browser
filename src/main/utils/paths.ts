/**
 * Path utilities for binaries and config files.
 * Handles platform-specific paths.
 */

import { app } from 'electron'
import path from 'path'

export function getBinaryPath(name: string): string {
  const platform = process.platform
  const ext = platform === 'win32' ? '.exe' : ''
  const binName = `${name}${ext}`

  // In development
  if (!app.isPackaged) {
    const platformDir = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'
    return path.join(app.getAppPath(), 'resources', 'bin', platformDir, binName)
  }

  // In production
  return path.join(process.resourcesPath, 'bin', binName)
}

export function getConfigPath(): string {
  // In development, use bundled config
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'resources', 'config', 'global.config.json')
  }

  // In production, use resources config
  return path.join(process.resourcesPath, 'config', 'global.config.json')
}

export function getStoragePath(): string {
  return path.join(app.getPath('userData'), 'storage')
}
