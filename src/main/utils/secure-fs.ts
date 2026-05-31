import * as fs from 'fs'
import { promises as fsp } from 'fs'
import * as path from 'path'

const SECURE_MODE = 0o600

/**
 * Atomic write of a JSON file. Writes to a .tmp sibling then renames,
 * so readers never observe a partially written file. On error, the tmp
 * file is unlinked best-effort to avoid leaving stale artifacts.
 */
export function writeJsonAtomic(filePath: string, data: unknown, indent: string | number = 2, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  const content = JSON.stringify(data, null, indent)
  try {
    if (mode !== undefined) {
      fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode })
    } else {
      fs.writeFileSync(tmp, content)
    }
    fs.renameSync(tmp, filePath)
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* tmp may not exist */
    }
    throw err
  }
}

/**
 * Like writeJsonAtomic but fsyncs the file handle before rename, so a crash or
 * power loss after the write leaves a complete file on disk (crash durability).
 * Synchronous; default permissions (non-secret data).
 */
export function writeJsonAtomicDurable(
  filePath: string,
  data: unknown,
  indent: string | number = 2,
  mode?: number
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  const content = JSON.stringify(data, null, indent)
  try {
    const fd = fs.openSync(tmp, 'w', mode)
    try {
      fs.writeSync(fd, content)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, filePath)
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* tmp may not exist */
    }
    throw err
  }
}

/**
 * Atomic write of a JSON file with 0o600 permissions on POSIX.
 * Use for files that may contain secrets (api keys, private keys, tokens).
 *
 * The tmp file is created with mode 0o600 at open time, so secret content
 * is never visible via default umask. After rename, a safety-net chmod
 * enforces 0o600 in case the target inode is reused from a previous 0o644
 * file on filesystems that preserve target mode across rename.
 */
export function writeSecureJsonAtomic(filePath: string, data: unknown, indent: string | number = '\t'): void {
  writeJsonAtomic(filePath, data, indent, SECURE_MODE)
  if (process.platform !== 'win32') fs.chmodSync(filePath, SECURE_MODE)
}

/**
 * Async atomic write of raw bytes (Buffer, Uint8Array, or string).
 * Writes to a .tmp sibling, fsyncs the handle for crash durability,
 * then renames. Readers never observe a partial file, and a kill -9
 * or power loss after the rename leaves a complete file on disk.
 *
 * On error, the tmp file is unlinked best-effort.
 */
export async function writeFileAtomic(
  filePath: string,
  data: Buffer | Uint8Array | string,
  options?: { mode?: number; encoding?: BufferEncoding }
): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  try {
    const handle = await fsp.open(tmp, 'w', options?.mode)
    try {
      await handle.writeFile(data, options?.encoding)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsp.rename(tmp, filePath)
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {
      /* tmp may not exist */
    })
    throw err
  }
}

/**
 * Async atomic write with 0o600 permissions on POSIX.
 * Use for encrypted blobs or any file that may contain secrets.
 *
 * The tmp file is created with mode 0o600 at open time, so secret content
 * is never visible via default umask. After rename, a safety-net chmod
 * enforces 0o600 in case the target inode is reused from a previous 0o644
 * file on filesystems that preserve target mode across rename.
 */
export async function writeSecureFileAtomic(
  filePath: string,
  data: Buffer | Uint8Array | string,
  encoding?: BufferEncoding
): Promise<void> {
  await writeFileAtomic(filePath, data, { mode: SECURE_MODE, encoding })
  if (process.platform !== 'win32') await fsp.chmod(filePath, SECURE_MODE)
}
