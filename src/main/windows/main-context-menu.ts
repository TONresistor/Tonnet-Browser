/**
 * Right-click context menu for the main window's React UI (cut/copy/paste,
 * copy-link). Rendered as a native overlay rather than a Chromium menu.
 * Extracted from index.ts (OPP-65). Distinct from the per-tab web-content
 * context menu in tabs-events.ts.
 */
import { BrowserWindow, clipboard } from 'electron'
import type { OverlayMenuItem } from '../../shared/types'
import type { OverlayManager } from './overlay-manager'
import { CONTEXT_MENU_WIDTH } from './constants'

export function setupMainContextMenu(mainWindow: BrowserWindow, overlayManager: OverlayManager): void {
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items: OverlayMenuItem[] = []

    if (params.isEditable) {
      items.push(
        { id: 'cut', label: 'Cut', disabled: !params.editFlags.canCut },
        { id: 'copy', label: 'Copy', disabled: !params.editFlags.canCopy },
        { id: 'paste', label: 'Paste', disabled: !params.editFlags.canPaste },
        { id: '_sep1', label: '', separator: true },
        { id: 'select-all', label: 'Select All' }
      )
    } else if (params.selectionText) {
      items.push({ id: 'copy', label: 'Copy' })
    }

    if (params.linkURL) {
      if (items.length > 0) items.push({ id: '_sep2', label: '', separator: true })
      items.push({ id: 'copy-link', label: 'Copy Link Address', data: { url: params.linkURL } })
    }

    if (items.length === 0) return

    const visibleItems = items.filter((i) => !i.separator).length
    const separators = items.filter((i) => i.separator).length
    const menuH = visibleItems * 36 + separators * 9 + 8
    const menuW = CONTEXT_MENU_WIDTH

    const [winW, winH] = mainWindow.getContentSize()
    const menuX = Math.max(0, Math.min(params.x, winW - menuW))
    const menuY = Math.max(0, Math.min(params.y, winH - menuH))

    overlayManager.show(
      'main-context-menu',
      { x: menuX, y: menuY, width: menuW, height: menuH },
      { type: 'menu', items },
      (actionType, actionData) => {
        switch (actionType) {
          case 'cut':
            mainWindow.webContents.cut()
            break
          case 'copy':
            mainWindow.webContents.copy()
            break
          case 'paste':
            mainWindow.webContents.paste()
            break
          case 'select-all':
            mainWindow.webContents.selectAll()
            break
          case 'copy-link':
            clipboard.writeText((actionData as Record<string, string>).url)
            break
          case 'dismiss':
            break
        }
        overlayManager.hide('main-context-menu')
      }
    )
  })
}
