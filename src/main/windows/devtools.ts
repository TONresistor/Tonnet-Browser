import type { BrowserWindow, WebContents, WebContentsView } from 'electron'

export type WebContentsInputHandler = (event: Electron.Event, input: Electron.Input) => void

export function isDevToolsShortcut(input: Electron.Input, platform: NodeJS.Platform = process.platform): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return false

  if (input.code === 'F12') {
    return !input.control && !input.shift && !input.alt && !input.meta
  }
  if (input.code !== 'KeyI') return false

  const controlShortcut = input.control && input.shift && !input.alt && !input.meta
  const macShortcut = platform === 'darwin' && input.meta && input.alt && !input.control && !input.shift
  return controlShortcut || macShortcut
}

export function toggleDevTools(contents: WebContents): boolean {
  if (contents.isDestroyed()) return false
  try {
    if (contents.isDevToolsOpened()) contents.closeDevTools()
    else contents.openDevTools({ mode: 'detach' })
    return true
  } catch {
    return false
  }
}

export function handleDevToolsShortcut(
  event: Electron.Event,
  input: Electron.Input,
  resolveTarget: () => WebContents | null,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!isDevToolsShortcut(input, platform)) return false
  event.preventDefault()
  const target = resolveTarget()
  if (target) toggleDevTools(target)
  return true
}

export function resolveDevToolsTarget(window: BrowserWindow, activeView: WebContentsView | null): WebContents {
  if (activeView && window.contentView.children.includes(activeView) && !activeView.webContents.isDestroyed()) {
    return activeView.webContents
  }
  return window.webContents
}
