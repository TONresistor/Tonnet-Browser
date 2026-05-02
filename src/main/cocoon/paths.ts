/**
 * Cocoon-specific path resolution.
 * Mirrors the pattern in src/main/utils/paths.ts but for Cocoon resources
 * (binaries already use getBinaryPath, this handles the spec/config templates).
 */

import { app } from 'electron'
import path from 'path'
import { getBinaryPath } from '../utils/paths'

export const COCOON_BINARIES = {
  cli: 'gocoon',
  runner: 'cocoon-runner',
} as const

export function getCocoonBinaryPath(name: keyof typeof COCOON_BINARIES): string {
  return getBinaryPath(COCOON_BINARIES[name])
}

/** Path to a file inside resources/cocoon/. */
export function getCocoonResource(filename: string): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'resources', 'cocoon', filename)
  }
  return path.join(process.resourcesPath, 'cocoon', filename)
}

export function getTonConfigPath(): string {
  return getCocoonResource('ton-config.json')
}

export function getClientConfigTemplatePath(): string {
  return getCocoonResource('client-config.template.json')
}

/** User-data directory for Cocoon (wallet, persistent state). */
export function getCocoonUserDataDir(): string {
  return path.join(app.getPath('userData'), 'cocoon')
}
