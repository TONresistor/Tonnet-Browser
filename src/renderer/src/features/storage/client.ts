import type { StorageBag } from '@shared/types'

/** Typed main-process boundary owned by the storage feature. */
export const storageClient = {
  listBags: () => window.electron.storage.listBags(),
  addBag: (bagId: string) => window.electron.storage.addBag(bagId),
  removeBag: (bagId: string) => window.electron.storage.removeBag(bagId),
  getBagDetails: (bagId: string) => window.electron.storage.getBagDetails(bagId),
  openFolder: (bagId: string) => window.electron.storage.openFolder(bagId),
  showFile: (bagId: string, fileName: string) => window.electron.storage.showFile(bagId, fileName),
  readFile: (bagId: string, filePath: string) => window.electron.storage.readFile(bagId, filePath),
  selectDownloadFolder: () => window.electron.storage.selectDownloadFolder(),
  onBagsUpdated: (listener: (bags: StorageBag[]) => void) => window.electron.on('storage:bags-updated', listener),
}
