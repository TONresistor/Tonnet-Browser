/**
 * DevTools access, shared by the main window and the tab views: keystrokes reach
 * the main window only while the browser chrome has focus, and go to the tab's
 * WebContentsView once the user clicks into a page, so both listen for the shortcut.
 */

import type { WebContents } from 'electron'

/** Ctrl+Shift+I, Cmd+Option+I (macOS) or F12. */
export function isDevToolsShortcut(input: Electron.Input): boolean {
  // keyUp would toggle a second time and close what keyDown just opened.
  if (input.type !== 'keyDown') return false
  // Physical keys: input.key is layout-dependent ('ш' on a Cyrillic layout, a
  // dead 'ˆ' for Option+I on a macOS US layout), so it never matches reliably.
  if (input.code === 'F12') return true
  if (input.code !== 'KeyI') return false
  return (input.control && input.shift) || (process.platform === 'darwin' && input.meta && input.alt)
}

/**
 * Toggle DevTools for `contents`, always detached: docked DevTools would render
 * underneath the WebContentsView that covers the window.
 */
export function toggleDevTools(contents: WebContents): void {
  if (contents.isDevToolsOpened()) {
    contents.closeDevTools()
  } else {
    contents.openDevTools({ mode: 'detach' })
  }
}

/** Open DevTools (detached) on the element at page coordinates (x, y). */
export function inspectElementAt(contents: WebContents, x: number, y: number): void {
  if (contents.isDevToolsOpened()) {
    contents.inspectElement(x, y)
    return
  }
  // inspectElement() would open DevTools docked on its own, so open them
  // detached first and inspect once they are ready to receive the request.
  contents.once('devtools-opened', () => contents.inspectElement(x, y))
  contents.openDevTools({ mode: 'detach' })
}
