import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { JournalStore } from '../../wallet-engine'
import { writeSecureFileAtomic } from '../utils/secure-fs'

/** Shared by all clients in the single-instance Electron profile. */
export class FileOperationJournalStore implements JournalStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly root = join(app.getPath('userData'), 'wallet-operations')) {}
  private path(account: string): string {
    return join(this.root, createHash('sha256').update(account).digest('hex') + '.json')
  }
  async read(account: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.path(account))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  compareExchange(account: string, expectedRevision: number, value: Buffer): Promise<void> {
    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        const previous = await this.read(account)
        const revision = previous === null ? 0 : JSON.parse(previous.toString('utf8')).revision
        if (revision !== expectedRevision) throw new Error('Operation journal revision conflict')
        await writeSecureFileAtomic(this.path(account), value)
        if (process.platform !== 'win32') {
          const directory = await fs.open(this.root, 'r')
          try {
            await directory.sync()
          } finally {
            await directory.close()
          }
        }
      })
    this.tail = run
    return run
  }
}
