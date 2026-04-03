import type { StorageManager } from './daemon'
import type { StorageBag } from '../../shared/types'

// Module-level reference, set via setBagsStorageManager()
let _storageManager: StorageManager | null = null

/** Set the StorageManager instance for bag operations. Called once from IPC handler registration. */
export function setBagsStorageManager(sm: StorageManager): void {
  _storageManager = sm
}

function getManager(): StorageManager {
  if (!_storageManager) throw new Error('StorageManager not initialized. Call setBagsStorageManager() first.')
  return _storageManager
}

/**
 * Bag management functions that delegate to StorageManager
 */

export async function addBag(bagId: string, _name?: string): Promise<StorageBag> {
  // Note: name parameter reserved for future use (custom bag naming)
  return getManager().addBag(bagId)
}

export async function removeBag(bagId: string, withFiles = false): Promise<boolean> {
  return getManager().removeBag(bagId, withFiles)
}

export async function listBags(): Promise<StorageBag[]> {
  return getManager().listBags()
}

export async function pauseBag(bagId: string): Promise<boolean> {
  return getManager().pauseBag(bagId)
}

export async function getBagDetails(bagId: string) {
  return getManager().getBagDetails(bagId)
}
