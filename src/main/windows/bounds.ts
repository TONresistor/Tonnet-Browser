/**
 * Main-window bounds persistence: restore position/size on launch, debounce
 * saves on move/resize, and flush synchronously on quit.
 *
 * Extracted from index.ts (OPP-65). Self-contained — owns the bounds file path
 * and the debounce timer so the three call sites no longer share module globals
 * in the bootstrap file. Does not touch createWindow's sandbox/CSP setup.
 */
import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import log from '../../shared/logger'
import { BOUNDS_SAVE_DEBOUNCE_MS } from './constants'
import { writeFileAtomic, writeSecureJsonAtomic } from '../utils/secure-fs'

const appLog = log.scope('app')

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const boundsFile = join(app.getPath('userData'), 'window-bounds.json')
const BOUNDS_SCHEMA_VERSION = 1
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null

interface BoundsDocument {
  schemaVersion: number
  bounds: WindowBounds
}

function decodeBounds(raw: unknown): WindowBounds | null {
  const envelope = raw && typeof raw === 'object' && 'schemaVersion' in raw && 'bounds' in raw
  if (envelope && (raw as Partial<BoundsDocument>).schemaVersion !== BOUNDS_SCHEMA_VERSION) return null
  const candidate = envelope ? (raw as Partial<BoundsDocument>).bounds : raw
  if (!candidate || typeof candidate !== 'object') return null
  const bounds = candidate as Partial<WindowBounds>
  if (
    typeof bounds.x !== 'number' ||
    typeof bounds.y !== 'number' ||
    typeof bounds.width !== 'number' ||
    typeof bounds.height !== 'number'
  ) {
    return null
  }
  return {
    ...bounds,
    isMaximized: typeof bounds.isMaximized === 'boolean' ? bounds.isMaximized : false,
  } as WindowBounds
}

function encodeBounds(bounds: WindowBounds): BoundsDocument {
  return { schemaVersion: BOUNDS_SCHEMA_VERSION, bounds }
}

export function loadWindowBounds(): Partial<WindowBounds> {
  try {
    if (existsSync(boundsFile)) {
      const data = readFileSync(boundsFile, 'utf-8')
      const bounds = decodeBounds(JSON.parse(data))
      if (!bounds) return {}

      // Validate bounds are on a visible display (top-left corner must be on some display)
      const displays = screen.getAllDisplays()
      const isVisible = displays.some((display) => {
        return (
          bounds.x >= display.bounds.x &&
          bounds.x < display.bounds.x + display.bounds.width &&
          bounds.y >= display.bounds.y &&
          bounds.y < display.bounds.y + display.bounds.height
        )
      })

      if (isVisible) {
        return bounds
      }
    }
  } catch (err) {
    appLog.error(`Failed to load bounds: ${String(err)}`)
  }
  return {}
}

export function saveWindowBounds(win: BrowserWindow): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    // Clear first so flushWindowBoundsOnQuit's `if (!saveBoundsTimer) return`
    // guard holds after we fire, avoiding a sync write racing this async one.
    saveBoundsTimer = null
    try {
      const bounds: WindowBounds = {
        ...win.getBounds(),
        isMaximized: win.isMaximized(),
      }
      writeFileAtomic(boundsFile, JSON.stringify(encodeBounds(bounds)), { encoding: 'utf8' }).catch((err) => {
        appLog.error(`Failed to save bounds: ${String(err)}`)
      })
    } catch (err) {
      appLog.error(`Failed to save bounds: ${String(err)}`)
    }
  }, BOUNDS_SAVE_DEBOUNCE_MS)
}

/**
 * Flush a pending (debounced) bounds save synchronously before the app quits.
 * No-op if no save was pending.
 */
export function flushWindowBoundsOnQuit(): void {
  if (!saveBoundsTimer) return
  clearTimeout(saveBoundsTimer)
  saveBoundsTimer = null
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) {
    try {
      const bounds = { ...wins[0].getBounds(), isMaximized: wins[0].isMaximized() }
      writeSecureJsonAtomic(boundsFile, encodeBounds(bounds))
    } catch (err) {
      log.error(`Failed to flush bounds on quit: ${String(err)}`)
    }
  }
}
