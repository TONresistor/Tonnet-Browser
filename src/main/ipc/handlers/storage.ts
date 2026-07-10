/**
 * IPC handlers for TON Storage bag management.
 */

import path from 'path'
import { promises as fsp } from 'fs'
import { shell } from 'electron'
import { decodeUtf8Prefix } from '../../utils/decode-utf8'
import { IpcBoundaryError, log } from './shared'
import { emitContractToRenderer } from '../../events/renderer-events'
import { getDownloadPath } from '../../settings'
import { resolveBagFilePath } from '../../windows/tabs-storage'
import type { ServiceRegistry } from '../../services'
import {
  storageAddBagContract,
  storageBagsUpdatedEventContract,
  storageGetDetailsContract,
  storageListBagsContract,
  storageOpenFolderContract,
  storagePauseBagContract,
  storageReadFileContract,
  storageRemoveBagContract,
  storageShowFileContract,
  storageStatusEventContract,
} from '../../../shared/ipc-contract/storage'
import { ipcFailure, ownIpcEmitterListener, secureContractHandle } from '../contract-handler'

/** Max bytes read for the in-app table viewer (CSV/JSONL); guards memory. */
const MAX_READ_BYTES = 32 * 1024 * 1024

/**
 * Validate that a resolved path is within the configured download directory.
 */
function validatePathInDownloadDir(targetPath: string): void {
  const downloadDir = path.resolve(getDownloadPath())
  const resolved = path.resolve(targetPath)
  // Ensure resolved path is inside the download directory (prevent path traversal)
  if (!resolved.startsWith(downloadDir + path.sep) && resolved !== downloadDir) {
    log.warn(`Blocked shell.openPath outside allowed directory: ${resolved}`)
    ipcFailure('PATH_OUTSIDE_DOWNLOAD_DIRECTORY', 'Path outside allowed directory')
  }
}

/**
 * Validate bag ID and return an error response if invalid.
 * Returns null if valid, or an error response object to short-circuit from handlers.
 */
export function registerStorageHandlers(registry: ServiceRegistry): void {
  const { storageManager } = registry

  // ===== Storage Events =====
  ownIpcEmitterListener(storageManager, 'bags-updated', (bags) => {
    emitContractToRenderer(storageBagsUpdatedEventContract, bags)
  })

  ownIpcEmitterListener(storageManager, 'started', () => {
    emitContractToRenderer(storageStatusEventContract, { running: true })
  })

  ownIpcEmitterListener(storageManager, 'stopped', () => {
    emitContractToRenderer(storageStatusEventContract, { running: false })
  })

  ownIpcEmitterListener(storageManager, 'error', (message) => {
    log.error(`Error: ${message}`)
  })

  // ===== Storage Handlers =====
  secureContractHandle(storageAddBagContract, async (bagId, _name?: string) => {
    // Security: Validate bag ID format
    const bag = await storageManager.addBag(bagId)
    return { success: true as const, bag }
  })

  secureContractHandle(storageRemoveBagContract, async (bagId) => {
    const result = await storageManager.removeBag(bagId)
    return { success: result }
  })

  secureContractHandle(storageListBagsContract, async () => {
    const bags = await storageManager.listBags()
    return { success: true as const, bags }
  })

  secureContractHandle(storagePauseBagContract, async (bagId) => {
    const result = await storageManager.pauseBag(bagId)
    return { success: result }
  })

  secureContractHandle(storageGetDetailsContract, async (bagId) => {
    try {
      const details = await storageManager.getBagDetails(bagId)
      return { success: true as const, details }
    } catch (error) {
      ipcFailure('STORAGE_DETAILS_FAILED', 'Unable to read bag details', false, error)
    }
  })

  secureContractHandle(storageOpenFolderContract, async (bagId) => {
    try {
      const details = await storageManager.getBagDetails(bagId)
      if (!details?.path) {
        ipcFailure('OPEN_FOLDER_FAILED', 'Bag path not found')
      }
      validatePathInDownloadDir(details.path)
      const error = await shell.openPath(path.resolve(details.path))
      if (error) ipcFailure('OPEN_FOLDER_FAILED', 'Unable to open bag folder', false, new Error(error))
      return { success: true as const }
    } catch (error) {
      if (error instanceof IpcBoundaryError) throw error
      ipcFailure('OPEN_FOLDER_FAILED', 'Unable to open bag folder', false, error)
    }
  })

  // Read a bag file's text for the in-app table viewer (CSV/JSONL). Path is
  // validated by resolveBagFilePath (no traversal); reads at most MAX_READ_BYTES.
  secureContractHandle(storageReadFileContract, async (bagId, relPath) => {
    try {
      const fullPath = await resolveBagFilePath(registry.tabManager.storage, bagId, relPath)
      const stat = await fsp.stat(fullPath)
      const len = Math.min(stat.size, MAX_READ_BYTES)
      const fh = await fsp.open(fullPath, 'r')
      try {
        const buf = Buffer.alloc(len)
        await fh.read(buf, 0, len, 0)
        return { success: true as const, content: decodeUtf8Prefix(buf), truncated: stat.size > len, size: stat.size }
      } finally {
        await fh.close()
      }
    } catch (error) {
      ipcFailure('READ_FILE_FAILED', 'Unable to read bag file', false, error)
    }
  })

  secureContractHandle(storageShowFileContract, async (bagId, fileName) => {
    // Validate fileName to prevent path traversal
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      ipcFailure('INVALID_FILE_NAME', 'Invalid file name')
    }

    // Validate length and null bytes
    if (fileName.length > 255 || fileName.includes('\0')) {
      ipcFailure('INVALID_FILE_NAME', 'Invalid file name')
    }

    // Sanitize fileName using path.basename to ensure it's just a filename
    const sanitizedFileName = path.basename(fileName)
    if (sanitizedFileName !== fileName) {
      ipcFailure('INVALID_FILE_NAME', 'Invalid file name')
    }

    try {
      const details = await storageManager.getBagDetails(bagId)
      if (!details?.path) {
        ipcFailure('SHOW_FILE_FAILED', 'Bag path not found')
      }
      const fullPath = path.join(details.path, sanitizedFileName)
      validatePathInDownloadDir(fullPath)
      shell.showItemInFolder(path.resolve(fullPath))
      return { success: true as const }
    } catch (error) {
      if (error instanceof IpcBoundaryError) throw error
      ipcFailure('SHOW_FILE_FAILED', 'Unable to reveal bag file', false, error)
    }
  })
}
