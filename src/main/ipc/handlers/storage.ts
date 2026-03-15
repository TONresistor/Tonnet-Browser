/**
 * IPC handlers for TON Storage bag management.
 */

import path from 'path'
import { shell } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types'
import { isValidBagId } from '../validation'
import { secureHandle, secureHandleWithEvent, handleSecure, storageLimiter, log } from './shared'
import { storageManager } from '../../storage/daemon'
import { addBag, removeBag, listBags, pauseBag, getBagDetails } from '../../storage/bags'
import { getMainWindow } from '../../windows/main'

/**
 * Validate bag ID and return an error response if invalid.
 * Returns null if valid, or an error response object to short-circuit from handlers.
 */
function validateBagIdOrFail(bagId: string): { success: false; error: string } | null {
  if (!isValidBagId(bagId)) {
    return { success: false, error: 'Invalid bag ID format (must be 64 hex characters)' }
  }
  return null
}

export function registerStorageHandlers(): void {
  // ===== Storage Events =====
  storageManager.on('bags-updated', (bags) => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('storage:bags-updated', bags)
    }
  })

  storageManager.on('started', () => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('storage:status', { running: true })
    }
  })

  storageManager.on('stopped', () => {
    const win = getMainWindow()
    if (win) {
      win.webContents.send('storage:status', { running: false })
    }
  })

  storageManager.on('error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Storage Handlers =====
  handleSecure(IPC_CHANNELS.STORAGE_ADD_BAG, async (_event, bagId: string, name?: string) => {
    // Rate limit storage operations
    if (!storageLimiter.check()) {
      return { success: false, error: 'Rate limited' }
    }

    // Security: Validate bag ID format
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError

    const bag = await addBag(bagId, name)
    return { success: true, bag }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_REMOVE_BAG, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    const result = await removeBag(bagId)
    return { success: result }
  })

  secureHandle(IPC_CHANNELS.STORAGE_LIST_BAGS, async () => {
    const bags = await listBags()
    return { success: true, bags }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_PAUSE_BAG, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    const result = await pauseBag(bagId)
    return { success: result }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_GET_DETAILS, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    try {
      const details = await getBagDetails(bagId)
      return { success: true, details }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_OPEN_FOLDER, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    try {
      const details = await getBagDetails(bagId)
      if (!details?.path) {
        return { success: false, error: 'Bag path not found' }
      }
      const error = await shell.openPath(details.path)
      return error ? { success: false, error } : { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_SHOW_FILE, async (_event, bagId: string, fileName: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError

    // Validate fileName to prevent path traversal
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return { success: false, error: 'Invalid file name: path separators not allowed' }
    }

    // Validate length and null bytes
    if (fileName.length > 255 || fileName.includes('\0')) {
      return { success: false, error: 'Invalid file name: exceeds length limit or contains null bytes' }
    }

    // Sanitize fileName using path.basename to ensure it's just a filename
    const sanitizedFileName = path.basename(fileName)
    if (sanitizedFileName !== fileName) {
      return { success: false, error: 'Invalid file name format' }
    }

    try {
      const details = await getBagDetails(bagId)
      if (!details?.path) {
        return { success: false, error: 'Bag path not found' }
      }
      shell.showItemInFolder(path.join(details.path, sanitizedFileName))
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
