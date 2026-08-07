/**
 * IPC handlers for bookmark persistence (load/save).
 */

import { bookmarksLoadContract, bookmarksSaveContract } from '../../../shared/ipc-contract/bookmarks'
import { secureContractHandle } from '../contract-handler'

export function registerBookmarkHandlers(): void {
  secureContractHandle(bookmarksLoadContract, async () => {
    const { loadBookmarks } = await import('../../bookmarks')
    return loadBookmarks()
  })

  secureContractHandle(bookmarksSaveContract, async (data) => {
    const { saveBookmarks } = await import('../../bookmarks')
    await saveBookmarks(data)
    return { success: true as const }
  })
}
