/**
 * IPC handlers for TON Storage bag management.
 */

import { errorMessage } from '../../../shared/errors'
import path from 'path'
import { promises as fsp } from 'fs'
import { shell } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc-channels'
import { isValidBagId } from '../validation'
import { decodeUtf8Prefix } from '../../utils/decode-utf8'
import { secureHandle, secureHandleWithEvent, emitToRenderer, storageLimiter, log } from './shared'
import { getDownloadPath } from '../../settings'
import { resolveBagFilePath } from '../../windows/tabs-storage'
import type { ServiceRegistry } from '../../services'

/** Max bytes read for the in-app table viewer (CSV/JSONL); guards memory. */
const MAX_READ_BYTES = 32 * 1024 * 1024

/**
 * Validate that a resolved path is within the configured download directory.
 * Returns null if valid, or an error response object to short-circuit from handlers.
 */
function validatePathInDownloadDir(targetPath: string): { success: false; error: string } | null {
  const downloadDir = path.resolve(getDownloadPath())
  const resolved = path.resolve(targetPath)
  // Ensure resolved path is inside the download directory (prevent path traversal)
  if (!resolved.startsWith(downloadDir + path.sep) && resolved !== downloadDir) {
    log.warn(`Blocked shell.openPath outside allowed directory: ${resolved}`)
    return { success: false, error: 'Path outside allowed directory' }
  }
  return null
}

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

export function registerStorageHandlers(registry: ServiceRegistry): void {
  const { storageManager } = registry

  // ===== Storage Events =====
  storageManager.on('bags-updated', (bags) => {
    emitToRenderer(IPC_CHANNELS.STORAGE_BAGS_UPDATED, bags)
  })

  storageManager.on('started', () => {
    emitToRenderer(IPC_CHANNELS.STORAGE_STATUS, { running: true })
  })

  storageManager.on('stopped', () => {
    emitToRenderer(IPC_CHANNELS.STORAGE_STATUS, { running: false })
  })

  storageManager.on('error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Storage Handlers =====
  secureHandle(IPC_CHANNELS.STORAGE_ADD_BAG, async (bagId: string, _name?: string) => {
    // Rate limit storage operations
    if (!storageLimiter.check()) {
      return { success: false, error: 'Rate limited' }
    }

    // Security: Validate bag ID format
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError

    const bag = await storageManager.addBag(bagId)
    return { success: true, bag }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_REMOVE_BAG, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    const result = await storageManager.removeBag(bagId)
    return { success: result }
  })

  secureHandle(IPC_CHANNELS.STORAGE_LIST_BAGS, async () => {
    const bags = await storageManager.listBags()
    return { success: true, bags }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_PAUSE_BAG, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    const result = await storageManager.pauseBag(bagId)
    return { success: result }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_GET_DETAILS, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    try {
      const details = await storageManager.getBagDetails(bagId)
      return { success: true, details }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  secureHandleWithEvent(IPC_CHANNELS.STORAGE_OPEN_FOLDER, async (_event, bagId: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError
    try {
      const details = await storageManager.getBagDetails(bagId)
      if (!details?.path) {
        return { success: false, error: 'Bag path not found' }
      }
      const pathError = validatePathInDownloadDir(details.path)
      if (pathError) return pathError
      const error = await shell.openPath(path.resolve(details.path))
      return error ? { success: false, error } : { success: true }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })

  // Read a bag file's text for the in-app table viewer (CSV/JSONL). Path is
  // validated by resolveBagFilePath (no traversal); reads at most MAX_READ_BYTES.
  secureHandleWithEvent(IPC_CHANNELS.STORAGE_READ_FILE, async (_event, bagId: string, relPath: string) => {
    const bagIdError = validateBagIdOrFail(bagId)
    if (bagIdError) return bagIdError

    try {
      const fullPath = await resolveBagFilePath(bagId, relPath)
      const stat = await fsp.stat(fullPath)
      const len = Math.min(stat.size, MAX_READ_BYTES)
      const fh = await fsp.open(fullPath, 'r')
      try {
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, 0)
        return { success: true, content: decodeUtf8Prefix(buf), truncated: stat.size > len, size: stat.size }
      } finally {
        await fh.close()
      }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
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
      const details = await storageManager.getBagDetails(bagId)
      if (!details?.path) {
        return { success: false, error: 'Bag path not found' }
      }
      const fullPath = path.join(details.path, sanitizedFileName)
      const pathError = validatePathInDownloadDir(fullPath)
      if (pathError) return pathError
      shell.showItemInFolder(path.resolve(fullPath))
      return { success: true }
    } catch (error) {
      return { success: false, error: errorMessage(error) }
    }
  })
}
