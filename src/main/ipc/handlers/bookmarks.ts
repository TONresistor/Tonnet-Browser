/**
 * IPC handlers for bookmark and folder context menus,
 * plus bookmark persistence (load/save).
 */

import { Menu } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { isValidNavigationUrl } from '../validation'
import { secureHandle, secureHandleWithEvent, emitToRenderer } from './shared'
import { getMainWindow } from '../../windows/main'
import { navigateInTab, getActiveTabId } from '../../windows/tabs'
import { loadBookmarks, saveBookmarks } from '../../bookmarks'
import type { BookmarksData } from '../../bookmarks'

export function registerBookmarkHandlers(): void {
  // ===== Bookmark Persistence =====
  secureHandle(IPC_CHANNELS.BOOKMARKS_LOAD, () => {
    return loadBookmarks()
  })

  secureHandle(IPC_CHANNELS.BOOKMARKS_SAVE, (data: BookmarksData) => {
    if (!data || !Array.isArray(data.bookmarks) || !Array.isArray(data.folders)) {
      throw new Error('Invalid bookmarks data')
    }
    saveBookmarks(data)
    return { success: true }
  })
  // ===== Bookmark Context Menu =====
  secureHandleWithEvent(IPC_CHANNELS.BOOKMARK_SHOW_MENU, (_event, id: string, title: string, url: string) => {
    const win = getMainWindow()
    if (!win) return

    const menu = Menu.buildFromTemplate([
      {
        label: 'Open in new tab',
        click: () => {
          if (isValidNavigationUrl(url).valid) {
            emitToRenderer('bookmark:open-new-tab', url)
          }
        },
      },
      {
        label: 'Edit',
        click: () => emitToRenderer('bookmark:edit', { id, title, url }),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => emitToRenderer('bookmark:delete', id),
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
        click: () => emitToRenderer('folder:rename', { folderId, folderName }),
      },
      {
        label: 'Open all bookmarks',
        click: () => emitToRenderer('folder:open-all', folderId),
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: () => emitToRenderer('folder:delete', folderId),
      },
    ])

    menu.popup({ window: win })
  })
}
