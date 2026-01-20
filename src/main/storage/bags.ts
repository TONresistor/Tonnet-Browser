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

export async function getBagDetails(bagId: string) {
  return storageManager.getBagDetails(bagId)
}
