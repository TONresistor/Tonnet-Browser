/**
 * IPC handlers for bookmark and folder context menus.
 */

import { Menu } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { isValidNavigationUrl } from '../validation'
import { secureHandleWithEvent } from './shared'
import { getMainWindow } from '../../windows/main'
import { navigateInTab, getActiveTabId } from '../../windows/tabs'

export function registerBookmarkHandlers(): void {
  // ===== Bookmark Context Menu =====
  secureHandleWithEvent(IPC_CHANNELS.BOOKMARK_SHOW_MENU, (_event, id: string, title: string, url: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open in new tab',
        click: () => {
          if (isValidNavigationUrl(url).valid) {
            win.webContents.send('bookmark:open-new-tab', url)
          }
        },
      },
      {
        label: 'Edit',
        click: () => win.webContents.send('bookmark:edit', { id, title, url }),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => win.webContents.send('bookmark:delete', id),
      },
    ])

    menu.popup({ window: win })
  })

  // ===== Folder Dropdown Menu =====
  secureHandleWithEvent(
    IPC_CHANNELS.FOLDER_SHOW_MENU,
    (_event, folderId: string, bookmarks: Array<{ id: string; title: string; url: string }>) => {
      const win = getMainWindow()
      if (!win) return

      // Build menu items from bookmarks
      const menuItems: Electron.MenuItemConstructorOptions[] = bookmarks.map((bookmark) => ({
        label: bookmark.title,
        click: () => {
          if (!isValidNavigationUrl(bookmark.url).valid) return
          const activeTabId = getActiveTabId()
          if (activeTabId) {
            navigateInTab(activeTabId, bookmark.url)
          }
        },
      }))

      // Show "Empty folder" if no bookmarks
      if (menuItems.length === 0) {
        menuItems.push({
          label: 'Empty folder',
          enabled: false,
        })
      }

      const menu = Menu.buildFromTemplate(menuItems)
      menu.popup({ window: win })
    }
  )

  // ===== Folder Context Menu =====
  secureHandleWithEvent(IPC_CHANNELS.FOLDER_SHOW_CONTEXT_MENU, (_event, folderId: string, folderName: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Rename',
        click: () => win.webContents.send('folder:rename', { folderId, folderName }),
      },
      {
        label: 'Open all bookmarks',
        click: () => win.webContents.send('folder:open-all', folderId),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => win.webContents.send('folder:delete', folderId),
      },
    ])

    menu.popup({ window: win })
  })
}
