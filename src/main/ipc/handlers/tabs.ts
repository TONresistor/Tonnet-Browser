/**
 * IPC handlers for tab management.
 */

import { log } from './shared'
import type { TabManager } from '../../windows/tabs'
import { tabCloseContract, tabCreateContract, tabSwitchContract } from '../../../shared/ipc-contract/browsing'
import { secureContractHandle } from '../contract-handler'

export function registerTabsHandlers(tabManager: TabManager): void {
  secureContractHandle(tabCreateContract, async (tabId) => {
    log.debug(`Tab create: ${tabId}`)
    const success = await tabManager.createTab(tabId)
    return { success }
  })

  secureContractHandle(tabCloseContract, (tabId) => {
    log.debug(`Tab close: ${tabId}`)
    const success = tabManager.closeTab(tabId)
    return { success }
  })

  secureContractHandle(tabSwitchContract, (tabId) => {
    log.debug(`Tab switch: ${tabId}`)
    const success = tabManager.switchTab(tabId)
    return { success }
  })
}
