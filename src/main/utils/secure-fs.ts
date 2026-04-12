import * as fs from 'fs'
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
