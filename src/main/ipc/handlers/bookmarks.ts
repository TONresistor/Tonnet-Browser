/**
 * IPC handlers for bookmark persistence (load/save).
 */

import { bookmarksLoadContract, bookmarksSaveContract } from '../../../shared/ipc-contract/bookmarks'
import { secureContractHandle } from '../contract-handler'
import { loadBookmarks, saveBookmarks } from '../../bookmarks'

export function registerBookmarkHandlers(): void {
  secureContractHandle(bookmarksLoadContract, () => loadBookmarks())

  secureContractHandle(bookmarksSaveContract, async (data) => {
    await saveBookmarks(data)
    return { success: true as const }
  })
}
