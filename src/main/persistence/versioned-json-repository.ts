import { promises as fs } from 'node:fs'
import type { z } from 'zod'
import { writeFileAtomic } from '../utils/secure-fs'
import { assertSupportedSchemaVersion, UnsupportedSchemaVersionError } from './schema-version'

export interface VersionedJsonRepositoryOptions<T> {
  filePath: string
  version: number
  schema: z.ZodType<T>
  defaults(): T
  migrate(raw: unknown, storedVersion: number): unknown
  mode?: number
  corruption?: 'throw' | 'reset-with-backup'
  now?: () => number
  onCorrupt?(error: unknown, backupPath: string): void
}

/** Async, atomic, serialized JSON persistence with explicit schema migration. */
export class VersionedJsonRepository<T> {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly options: VersionedJsonRepositoryOptions<T>) {}

  async load(): Promise<T> {
    let raw: string
    try {
      raw = await fs.readFile(this.options.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const defaults = this.options.defaults()
      await this.save(defaults)
      return defaults
    }

    if (!raw.trim()) return this.options.defaults()
    return this.parse(raw)
  }

  async loadOptional(): Promise<T | null> {
    let raw: string
    try {
      raw = await fs.readFile(this.options.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (!raw.trim()) return null
    return this.parse(raw)
  }

  private async parse(raw: string): Promise<T> {
    try {
      const parsed: unknown = JSON.parse(raw)
      const storedVersion = readStoredVersion(parsed)
      assertSupportedSchemaVersion(storedVersion, this.options.version, this.options.filePath)
      const migrated = this.options.migrate(parsed, storedVersion)
      return this.options.schema.parse(migrated)
    } catch (error) {
      if (this.options.corruption !== 'reset-with-backup' || error instanceof UnsupportedSchemaVersionError) {
        throw error
      }
      const backupPath = `${this.options.filePath}.corrupt-${(this.options.now ?? Date.now)()}`
      await fs.rename(this.options.filePath, backupPath)
      this.options.onCorrupt?.(error, backupPath)
      const defaults = this.options.defaults()
      await this.save(defaults)
      return defaults
    }
  }

  async save(value: T): Promise<void> {
    const validated = this.options.schema.parse(value)
    const encoded = JSON.stringify(
      { schemaVersion: this.options.version, ...(validated as Record<string, unknown>) },
      null,
      2
    )

    const write = this.writeChain
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.options.filePath, encoded, { mode: this.options.mode, encoding: 'utf8' }))
    this.writeChain = write
    await write
  }

  async remove(): Promise<void> {
    await this.writeChain.catch(() => undefined)
    await fs.unlink(this.options.filePath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

function readStoredVersion(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const version = (value as { schemaVersion?: unknown }).schemaVersion
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
}
