/**
 * Cocoon platform availability check.
 * gocoon is cross-platform. The browser still validates the binary set it
 * knows how to build/package, and Linux keeps the GLIBC floor required by the
 * native runner environment.
 */

import { execSync } from 'child_process'
import { createLogger } from '../../shared/logger'

const log = createLogger('cocoon:platform')

export type CocoonAvailability =
  | { available: true }
  | { available: false; reason: 'platform' | 'arch' | 'glibc'; message: string }

const MIN_GLIBC_MAJOR = 2
const MIN_GLIBC_MINOR = 38

let cachedResult: CocoonAvailability | null = null

export function checkCocoonAvailability(): CocoonAvailability {
  if (cachedResult) return cachedResult

  if (!isSupportedPlatform(process.platform)) {
    cachedResult = {
      available: false,
      reason: 'platform',
      message: `Cocoon AI is not supported on ${process.platform}. Supported platforms: Linux, macOS, Windows.`,
    }
    return cachedResult
  }

  if (!isSupportedArch(process.platform, process.arch)) {
    cachedResult = {
      available: false,
      reason: 'arch',
      message: `Cocoon AI is not packaged for ${process.platform}/${process.arch}.`,
    }
    return cachedResult
  }

  if (process.platform !== 'linux') {
    cachedResult = { available: true }
    return cachedResult
  }

  const glibc = detectGlibcVersion()
  if (!glibc) {
    log.warn('Could not detect GLIBC version, allowing Cocoon to attempt launch')
    cachedResult = { available: true }
    return cachedResult
  }

  if (glibc.major < MIN_GLIBC_MAJOR || (glibc.major === MIN_GLIBC_MAJOR && glibc.minor < MIN_GLIBC_MINOR)) {
    cachedResult = {
      available: false,
      reason: 'glibc',
      message: `Cocoon AI requires GLIBC ${MIN_GLIBC_MAJOR}.${MIN_GLIBC_MINOR}+. System has ${glibc.major}.${glibc.minor}. Upgrade to Debian 13+, Ubuntu 24.04+, or Fedora 39+.`,
    }
    return cachedResult
  }

  cachedResult = { available: true }
  return cachedResult
}

function isSupportedPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'linux' || platform === 'darwin' || platform === 'win32'
}

function isSupportedArch(platform: NodeJS.Platform, arch: NodeJS.Architecture): boolean {
  if (platform === 'darwin') return arch === 'x64' || arch === 'arm64'
  if (platform === 'linux') return arch === 'x64' || arch === 'arm64'
  return arch === 'x64'
}

function detectGlibcVersion(): { major: number; minor: number } | null {
  try {
    const output = execSync('ldd --version', { encoding: 'utf-8', timeout: 2000 })
    const match = output.match(/(\d+)\.(\d+)/)
    if (!match) return null
    return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) }
  } catch {
    return null
  }
}
