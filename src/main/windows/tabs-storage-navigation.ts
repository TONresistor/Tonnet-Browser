import type { WebContentsView } from 'electron'
import { loadStorageBag, resolveBagFilePath } from './tabs-storage'
import { ensureViewIdentity, type TabViewLifecycleManager } from './tabs-view-lifecycle'

interface StorageNavigationManager extends TabViewLifecycleManager {
  beginNavigation(tabId: string): number
  showActiveView(): void
}

export async function loadStorageBagFor(
  manager: StorageNavigationManager,
  tabId: string,
  bagId: string
): Promise<void> {
  const generation = manager.captureWindowGeneration()
  const navigationEpoch = manager.beginNavigation(tabId)
  let view: WebContentsView
  try {
    view = await ensureViewIdentity(manager, tabId, `bag:${bagId.toLowerCase()}`, navigationEpoch)
  } catch (error) {
    if (!manager.ownsWindowGeneration(generation) || !manager.ownsNavigation(tabId, navigationEpoch)) return
    throw error
  }
  const isCurrent = (): boolean =>
    manager.ownsWindowGeneration(generation) &&
    manager.ownsNavigation(tabId, navigationEpoch) &&
    manager.views.get(tabId) === view

  await loadStorageBag(manager.storage, view, {
    bagId,
    label: bagId.slice(0, 16) + '.bag',
    timeout: 60,
    useCache: true,
    checkIndexHtml: true,
    isCurrent,
  })
}

export async function loadBagFileFor(
  manager: StorageNavigationManager,
  tabId: string,
  bagId: string,
  relPath: string
): Promise<void> {
  const generation = manager.captureWindowGeneration()
  const navigationEpoch = manager.beginNavigation(tabId)
  let view: WebContentsView
  try {
    view = await ensureViewIdentity(manager, tabId, `bag:${bagId.toLowerCase()}`, navigationEpoch)
  } catch (error) {
    if (!manager.ownsWindowGeneration(generation) || !manager.ownsNavigation(tabId, navigationEpoch)) return
    throw error
  }
  const fullPath = await resolveBagFilePath(manager.storage, bagId, relPath)
  if (
    !manager.ownsWindowGeneration(generation) ||
    !manager.ownsNavigation(tabId, navigationEpoch) ||
    manager.views.get(tabId) !== view
  )
    return
  await view.webContents.loadFile(fullPath)
  if (manager.ownsNavigation(tabId, navigationEpoch) && tabId === manager.getActiveTabId()) manager.showActiveView()
}
