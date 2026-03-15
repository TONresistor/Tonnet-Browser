/**
 * IPC handlers for browsing history management.
 */

import { IPC_CHANNELS } from '../../../shared/types'
import { secureHandleWithEvent, log } from './shared'
import { historyManager, HistoryMode } from '../../history/manager'

export function registerHistoryHandlers(): void {
  secureHandleWithEvent(IPC_CHANNELS.HISTORY_CHANGE_MODE, async (_event, mode: HistoryMode) => {
    const validModes = ['memory', 'persistent']
    if (!validModes.includes(mode)) {
      return { success: false, error: `Invalid history mode: ${mode}` }
    }
    try {
      const result = await historyManager.changeMode(mode)
      return result
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_SEARCH, (_event, query: string, limit?: number) => {
    try {
      return historyManager.search(query, limit)
    } catch (error) {
      log.error(`Search failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_RECENT, (_event, limit?: number) => {
    try {
      return historyManager.getRecent(limit)
    } catch (error) {
      log.error(`Get recent failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_TOP, (_event, limit?: number) => {
    try {
      return historyManager.getTopVisited(limit)
    } catch (error) {
      log.error(`Get top visited failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_BY_DATE, (_event, startDate: number, endDate: number) => {
    try {
      return historyManager.getByDateRange(startDate, endDate)
    } catch (error) {
      log.error(`Get by date range failed: ${String(error)}`)
      return []
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_DELETE, (_event, id: string) => {
    try {
      const success = historyManager.deleteEntry(id)
      return { success }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_DELETE_PATTERN, (_event, pattern: string) => {
    try {
      const count = historyManager.deleteByPattern(pattern)
      return { success: true, count }
    } catch (error) {
      return { success: false, error: (error as Error).message, count: 0 }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_CLEAR, () => {
    try {
      historyManager.clear()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_GET_STATS, () => {
    try {
      return historyManager.getStats()
    } catch (error) {
      return {
        total: 0,
        mode: 'memory' as HistoryMode,
        isLocked: false,
      }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.HISTORY_HAS_PERSISTENT_FILE, () => {
    try {
      return historyManager.hasPersistentFile()
    } catch (error) {
      return false
    }
  })
}
