import { storageManager } from './daemon'
import type { StorageBag } from '../../shared/types'

/**
 * Bag management functions that delegate to StorageManager
 */

export async function addBag(bagId: string, _name?: string): Promise<StorageBag> {
  // Note: name parameter reserved for future use (custom bag naming)
  return storageManager.addBag(bagId)
}

export async function removeBag(bagId: string, withFiles = false): Promise<boolean> {
  return storageManager.removeBag(bagId, withFiles)
}

export async function listBags(): Promise<StorageBag[]> {
  return storageManager.listBags()
}

export async function pauseBag(bagId: string): Promise<boolean> {
  return storageManager.pauseBag(bagId)
}

export async function resumeBag(bagId: string): Promise<boolean> {
  // tonutils-storage doesn't have a resume - need to re-add
  // For now, just return false as it's not easily supported
  console.warn('[bags] Resume not supported in tonutils-storage')
  return false
}

export async function getBagDetails(bagId: string) {
  return storageManager.getBagDetails(bagId)
}
