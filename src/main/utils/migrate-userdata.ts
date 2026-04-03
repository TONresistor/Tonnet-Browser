/**
 * One-shot migration: unify split userData directories.
 *
 * Electron uses app.name to compute userData path. Old versions used
 * "TON Browser" (with space), new versions use "ton-browser" (package.json name).
 * This module detects the legacy directory and merges it into the canonical one
 * before any other code touches userData.
 *
 * Must be called synchronously before app.getPath('userData') is used.
 */

import {
  existsSync,
  readdirSync,
  renameSync,
  statSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { createLogger } from '../../shared/logger'

const log = createLogger('migrate')

const LEGACY_NAME = 'TON Browser'
const MIGRATED_MARKER = '.migrated-from-legacy'

/** User data files worth migrating (keep the more recent copy). */
const USER_FILES = [
  'app-settings.json',
  'bookmarks.json',
  'window-bounds.json',
  'wallet-key.dat',
  'history.dat',
  'history.encrypted.json',
  'bags.json',
  'nft-cache.dat',
  'wallet-history.dat',
]

/** Directories whose contents should be merged (not replaced wholesale). */
const MERGE_DIRS = ['storage', 'proxy', 'bridge']

/**
 * Only USER_FILES and MERGE_DIRS are migrated. Everything else in the legacy
 * directory (Chromium caches, session storage, cookies, etc.) is left behind
 * and the entire legacy directory is removed after migration.
 */

/**
 * Compute the legacy userData path (what Electron would use for "TON Browser").
 * We cannot call app.getPath because app.name is already the canonical value
 * at this point, so we reconstruct the platform-specific path manually.
 */
function getLegacyDir(canonicalDir: string): string {
  // canonicalDir is e.g. /home/user/.config/ton-browser
  // legacyDir should be   /home/user/.config/TON Browser
  const parent = dirname(canonicalDir)
  return join(parent, LEGACY_NAME)
}

/** Backup a file before overwriting. Skips if backup already exists (idempotent). */
function backup(filePath: string): void {
  const bakPath = filePath + '.pre-migration.bak'
  if (existsSync(filePath) && !existsSync(bakPath)) {
    try {
      copyFileSync(filePath, bakPath)
    } catch {
      // non-fatal
    }
  }
}

/** Return mtime of a file, or 0 if it doesn't exist. */
function mtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

/** Move a single file from src to dst, keeping the newer version. */
function migrateFile(src: string, dst: string, name: string): void {
  const srcFile = join(src, name)
  const dstFile = join(dst, name)

  if (!existsSync(srcFile)) return

  if (!existsSync(dstFile)) {
    renameSync(srcFile, dstFile)
    log.info(`Moved ${name}`)
    return
  }

  // Both exist: keep the more recent one
  if (mtime(srcFile) > mtime(dstFile)) {
    backup(dstFile)
    renameSync(srcFile, dstFile)
    log.info(`Replaced ${name} (legacy was newer)`)
  } else {
    log.info(`Kept ${name} (canonical was newer)`)
  }
}

/**
 * Directories that are databases (LevelDB, etc.) and must be treated as
 * atomic units -- never merge individual files within them.
 */
const ATOMIC_DIRS = new Set(['db'])

/**
 * Merge a directory from legacy into canonical.
 * Sub-entries that don't exist in canonical are moved.
 * Sub-entries that exist in both are kept from the more recent source,
 * except for ATOMIC_DIRS which are treated as single units.
 */
function mergeDir(srcDir: string, dstDir: string): void {
  if (!existsSync(srcDir)) return

  if (!existsSync(dstDir)) {
    renameSync(srcDir, dstDir)
    log.info(`Moved directory ${srcDir}`)
    return
  }

  let entries: string[]
  try {
    entries = readdirSync(srcDir)
  } catch {
    return
  }

  for (const entry of entries) {
    const srcPath = join(srcDir, entry)
    const dstPath = join(dstDir, entry)

    try {
      const srcStat = statSync(srcPath)

      if (srcStat.isDirectory()) {
        if (!existsSync(dstPath)) {
          renameSync(srcPath, dstPath)
        } else if (ATOMIC_DIRS.has(entry)) {
          // Database directories: keep the one with the more recent mtime, don't merge files
          if (srcStat.mtimeMs > mtime(dstPath)) {
            // Backup canonical db before replacing, so we can recover if rename fails
            const bakPath = dstPath + '.pre-migration.bak'
            if (!existsSync(bakPath)) {
              renameSync(dstPath, bakPath)
            } else {
              rmSync(dstPath, { recursive: true, force: true })
            }
            try {
              renameSync(srcPath, dstPath)
              rmSync(bakPath, { recursive: true, force: true })
            } catch (renameErr) {
              // Restore backup if rename failed
              if (!existsSync(dstPath) && existsSync(bakPath)) {
                renameSync(bakPath, dstPath)
              }
              throw renameErr
            }
            log.info(`Replaced atomic dir ${entry} (legacy was newer)`)
          }
        } else {
          mergeDir(srcPath, dstPath)
        }
      } else {
        if (!existsSync(dstPath)) {
          renameSync(srcPath, dstPath)
        } else if (srcStat.mtimeMs > mtime(dstPath)) {
          backup(dstPath)
          renameSync(srcPath, dstPath)
        }
      }
    } catch (err) {
      log.warn(`Skip entry ${entry}: ${String(err)}`)
    }
  }
}

/** Patch downloadPath in app-settings.json if it still references the legacy dir. */
function patchSettings(canonicalDir: string, legacyDir: string): void {
  const settingsFile = join(canonicalDir, 'app-settings.json')
  if (!existsSync(settingsFile)) return

  try {
    const raw = readFileSync(settingsFile, 'utf-8')

    // JSON stores backslashes escaped (Windows: C:\\Users\\...),
    // so match both raw and escaped forms of the paths.
    const escapedLegacy = legacyDir.replace(/\\/g, '\\\\')
    const escapedCanonical = canonicalDir.replace(/\\/g, '\\\\')

    let patched = raw
    if (patched.includes(escapedLegacy)) {
      patched = patched.split(escapedLegacy).join(escapedCanonical)
    }
    if (patched.includes(legacyDir)) {
      patched = patched.split(legacyDir).join(canonicalDir)
    }

    if (patched === raw) return
    writeFileSync(settingsFile, patched)
    log.info('Patched settings paths from legacy to canonical')
  } catch (err) {
    log.warn(`Failed to patch settings: ${String(err)}`)
  }
}

/**
 * Remove the legacy directory. After migration, only Chromium-managed files
 * remain (caches, cookies, session storage) which are regenerated on startup.
 * All user data has already been moved to the canonical directory.
 */
function removeLegacy(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
    log.info('Removed legacy directory')
  } catch (err) {
    log.warn(`Could not remove legacy directory: ${String(err)}`)
  }
}

/**
 * Run the migration. Call this synchronously before any code uses
 * app.getPath('userData').
 */
export function migrateUserData(canonicalDir: string): void {
  const legacyDir = getLegacyDir(canonicalDir)

  // No legacy directory: nothing to do (case 1 or fresh install)
  if (!existsSync(legacyDir)) return

  // Already migrated in a previous run
  if (existsSync(join(canonicalDir, MIGRATED_MARKER))) return

  // Snapshot before logging (electron-log may create canonicalDir/logs/ on first write)
  const canonicalExists = existsSync(canonicalDir)

  log.info(`Legacy userData detected at ${legacyDir}, starting migration...`)

  // Case 2: canonical doesn't exist yet, just rename
  if (!canonicalExists) {
    try {
      renameSync(legacyDir, canonicalDir)
      patchSettings(canonicalDir, legacyDir)
      writeFileSync(join(canonicalDir, MIGRATED_MARKER), new Date().toISOString())
      log.info('Migration complete (renamed legacy -> canonical)')
      return
    } catch (err) {
      log.error(`Failed to rename legacy dir: ${String(err)}`)
      return
    }
  }

  // Case 3: both exist, merge legacy into canonical
  try {
    // Ensure canonical exists
    mkdirSync(canonicalDir, { recursive: true })

    // Migrate individual user files
    for (const file of USER_FILES) {
      migrateFile(legacyDir, canonicalDir, file)
    }

    // Merge directories
    for (const dir of MERGE_DIRS) {
      mergeDir(join(legacyDir, dir), join(canonicalDir, dir))
    }

    // Patch settings paths
    patchSettings(canonicalDir, legacyDir)

    // Mark as done
    writeFileSync(join(canonicalDir, MIGRATED_MARKER), new Date().toISOString())
    log.info('Migration complete (merged legacy into canonical)')

    // Remove legacy dir (only Chromium caches remain, all user data was migrated)
    removeLegacy(legacyDir)
  } catch (err) {
    log.error(`Migration failed: ${String(err)}`)
    // Non-fatal: the app continues with whatever state we have
  }
}
