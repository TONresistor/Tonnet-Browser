import { promises as fs } from 'node:fs'
import type { z } from 'zod'
import type { ISecureStorage } from '../ports/secure-storage'
import { SENC_MARKER, writeSencJsonFile } from '../utils/senc'
import { assertSupportedSchemaVersion } from './schema-version'

export type EncryptedDocumentErrorStage = 'format' | 'decrypt' | 'parse' | 'schema'

export class EncryptedDocumentError extends Error {
  constructor(
    readonly stage: EncryptedDocumentErrorStage,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'EncryptedDocumentError'
  }
}

export interface VersionedEncryptedJsonRepositoryOptions<T> {
  filePath: string
  version: number
  schema: z.ZodType<T>
  storage: ISecureStorage
  migrate(raw: unknown, storedVersion: number): unknown
}

/** Serialized, atomic SENC persistence for schemas containing secrets. */
export class VersionedEncryptedJsonRepository<T> {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly options: VersionedEncryptedJsonRepositoryOptions<T>) {}

  async loadOptional(): Promise<T | null> {
    let encrypted: Buffer
    try {
      encrypted = await fs.readFile(this.options.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    if (!encrypted.subarray(0, SENC_MARKER.length).equals(SENC_MARKER)) {
      throw new EncryptedDocumentError('format', `Unexpected file format at ${this.options.filePath}`)
    }
    let decrypted: string
    try {
      decrypted = this.options.storage.decrypt(encrypted.subarray(SENC_MARKER.length))
    } catch (error) {
      throw new EncryptedDocumentError('decrypt', `Failed to decrypt ${this.options.filePath}`, { cause: error })
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(decrypted)
    } catch (error) {
      throw new EncryptedDocumentError('parse', `Invalid JSON in ${this.options.filePath}`, { cause: error })
    }
    const storedVersion = readStoredVersion(parsed)
    assertSupportedSchemaVersion(storedVersion, this.options.version, this.options.filePath)
    const migrated = this.options.migrate(parsed, storedVersion)
    try {
      return this.options.schema.parse(migrated)
    } catch (error) {
      throw new EncryptedDocumentError('schema', `Invalid schema in ${this.options.filePath}`, { cause: error })
    }
  }

  async save(value: T): Promise<void> {
    const validated = this.options.schema.parse(value)
    const document = { schemaVersion: this.options.version, ...(validated as Record<string, unknown>) }
    const write = this.writeChain
      .catch(() => undefined)
      .then(() => writeSencJsonFile(this.options.filePath, this.options.storage, document))
    this.writeChain = write
    await write
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.options.filePath)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
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
