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
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import log from '../../shared/logger'
import { BOUNDS_SAVE_DEBOUNCE_MS } from './constants'

const appLog = log.scope('app')

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const boundsFile = join(app.getPath('userData'), 'window-bounds.json')
let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null

export function loadWindowBounds(): Partial<WindowBounds> {
  try {
    if (existsSync(boundsFile)) {
      const data = readFileSync(boundsFile, 'utf-8')
      const bounds = JSON.parse(data) as WindowBounds

      if (
        typeof bounds.x !== 'number' ||
        typeof bounds.y !== 'number' ||
        typeof bounds.width !== 'number' ||
        typeof bounds.height !== 'number'
      ) {
        return {}
      }

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
      writeFile(boundsFile, JSON.stringify(bounds)).catch((err) => {
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
      writeFileSync(boundsFile, JSON.stringify(bounds))
    } catch (err) {
      log.error(`Failed to flush bounds on quit: ${String(err)}`)
    }
  }
}
