import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

export async function getWalletStorageFingerprint(filePath: string): Promise<string | null> {
  try {
    const data = await fs.readFile(filePath)
    return createHash('sha256').update(data).digest('hex')
  } catch (error) {
    if (isEnoent(error)) return null
    throw error
  }
}

export async function deleteWalletStorage(candidates: string[]): Promise<void> {
  for (const filePath of candidates) {
    try {
      await fs.unlink(filePath)
    } catch (error) {
      if (!isEnoent(error)) throw error
    }
  }
}

export async function quarantineWalletStorage(
  filePath: string,
  candidates: string[],
  expectedFingerprint: string
): Promise<{ recoveryId: string }> {
  const currentFingerprint = await getWalletStorageFingerprint(filePath)
  if (!currentFingerprint) throw new Error('No wallet data found')
  if (currentFingerprint !== expectedFingerprint) throw new Error('Wallet data changed before local reset')

  const recoveryId = `${Date.now()}-${randomUUID()}`
  const recoveryDir = join(dirname(filePath), 'wallet-recovery', recoveryId)
  const moved: Array<{ source: string; destination: string }> = []
  await fs.mkdir(recoveryDir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await fs.chmod(recoveryDir, 0o700)

  try {
    for (const source of candidates) {
      try {
        await fs.access(source)
      } catch (error) {
        if (isEnoent(error)) continue
        throw error
      }
      const destination = join(recoveryDir, basename(source))
      await fs.rename(source, destination)
      moved.push({ source, destination })
    }
    if (!moved.some(({ source }) => source === filePath)) throw new Error('No active wallet was quarantined')
    return { recoveryId }
  } catch (error) {
    for (const entry of moved.reverse()) {
      await fs.rename(entry.destination, entry.source).catch(() => undefined)
    }
    throw error
  }
}
