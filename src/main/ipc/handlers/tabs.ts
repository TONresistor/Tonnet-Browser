/**
 * IPC handlers for tab management.
 */

import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { secureHandleWithEvent, log } from './shared'
import { createTab, closeTab, switchTab } from '../../windows/tabs'

export function registerTabsHandlers(): void {
  secureHandleWithEvent(IPC_CHANNELS.TAB_CREATE, async (_event, tabId: string) => {
    log.debug(`Tab create: ${tabId}`)
    const success = await createTab(tabId)
    return { success }
  })

  secureHandleWithEvent(IPC_CHANNELS.TAB_CLOSE, (_event, tabId: string) => {
    log.debug(`Tab close: ${tabId}`)
    const success = closeTab(tabId)
    return { success }
  })

  secureHandleWithEvent(IPC_CHANNELS.TAB_SWITCH, (_event, tabId: string) => {
    log.debug(`Tab switch: ${tabId}`)
    const success = switchTab(tabId)
    return { success }
  })
}
