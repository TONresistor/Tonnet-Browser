/**
 * Shared context menu builder.
 * Reduces duplication between main window and BrowserView context menus.
 */

import { Menu, clipboard } from 'electron'

export interface ContextMenuOptions {
  webContents: Electron.WebContents
  onOpenLink?: (url: string) => void
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  onReload?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
}

/**
 * Build and show a context menu from right-click params.
 * Handles text editing (cut/copy/paste), link options, and image options.
 * Callers can add navigation or tab-specific items via options.
 */
export function buildContextMenu(
  params: Electron.ContextMenuParams,
  options: ContextMenuOptions
): void {
  const { webContents } = options
  const menuItems: Electron.MenuItemConstructorOptions[] = []

  // Text editing options
  if (params.isEditable) {
    menuItems.push(
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: params.editFlags.canCut, click: () => webContents.cut() },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: params.editFlags.canCopy, click: () => webContents.copy() },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: params.editFlags.canPaste, click: () => webContents.paste() },
      { type: 'separator' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: () => webContents.selectAll() }
    )
  } else if (params.selectionText) {
    menuItems.push(
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => webContents.copy() }
    )
  }

  // Link options
  if (params.linkURL) {
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    if (options.onOpenLink) {
      menuItems.push(
        { label: 'Open Link in New Tab', click: () => options.onOpenLink!(params.linkURL) }
      )
    }
    menuItems.push(
      { label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) }
    )
  }

  // Image options
  if (params.hasImageContents && params.srcURL) {
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    menuItems.push(
      { label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) }
    )
  }

  // Navigation options (optional, for BrowserView tabs)
  if (options.onNavigateBack || options.onNavigateForward || options.onReload) {
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    if (options.onNavigateBack) {
      menuItems.push(
        { label: 'Back', accelerator: 'Alt+Left', enabled: options.canGoBack ?? false, click: () => options.onNavigateBack!() }
      )
    }
    if (options.onNavigateForward) {
      menuItems.push(
        { label: 'Forward', accelerator: 'Alt+Right', enabled: options.canGoForward ?? false, click: () => options.onNavigateForward!() }
      )
    }
    if (options.onReload) {
      menuItems.push(
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => options.onReload!() }
      )
    }
  }

  // Show menu only if there are items
  if (menuItems.length > 0) {
    Menu.buildFromTemplate(menuItems).popup()
  }
}
