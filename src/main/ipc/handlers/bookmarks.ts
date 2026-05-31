/**
 * IPC handlers for bookmark persistence (load/save).
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { secureHandle } from './shared'
import { loadBookmarks, saveBookmarks } from '../../bookmarks'
import type { BookmarksData } from '../../bookmarks'

export function registerBookmarkHandlers(): void {
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
}
