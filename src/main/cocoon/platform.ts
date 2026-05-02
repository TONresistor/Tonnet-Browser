/**
 * Cocoon platform availability check.
 * Cocoon binaries are Linux x64 only and require GLIBC 2.38+ (client-runner).
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

  if (process.platform !== 'linux') {
    cachedResult = {
      available: false,
      reason: 'platform',
      message: 'Cocoon AI requires Linux. Windows and macOS are not supported yet.',
    }
    return cachedResult
  }

  if (process.arch !== 'x64') {
    cachedResult = {
      available: false,
      reason: 'arch',
      message: `Cocoon AI requires x86_64. Current architecture: ${process.arch}`,
    }
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

/** Test-only: reset cached result */
export function resetCocoonAvailabilityCache(): void {
  cachedResult = null
}
