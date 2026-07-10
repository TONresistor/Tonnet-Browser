import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ISecureStorage } from '../../ports/secure-storage'
import { decodeSenc, writeSencJsonFile } from '../../utils/senc'
import { VersionedEncryptedJsonRepository } from '../versioned-encrypted-json-repository'

const directories: string[] = []
const schema = z.object({ values: z.array(z.string()) })
const storage: ISecureStorage = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8'),
  decrypt: (value) => value.toString('utf8'),
  getBackendName: () => 'test',
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'encrypted-repository-'))
  directories.push(directory)
  const filePath = join(directory, 'data.dat')
  return {
    filePath,
    repository: new VersionedEncryptedJsonRepository({
      filePath,
      version: 2,
      schema,
      storage,
      migrate: (raw) => raw,
    }),
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('VersionedEncryptedJsonRepository', () => {
  it('returns null without creating a secret file when none exists', async () => {
    const { repository } = await fixture()
    await expect(repository.loadOptional()).resolves.toBeNull()
  })

  it('loads legacy encrypted documents and writes the version inside the encrypted envelope', async () => {
    const { filePath, repository } = await fixture()
    await writeSencJsonFile(filePath, storage, { values: ['legacy'] })
    await expect(repository.loadOptional()).resolves.toEqual({ values: ['legacy'] })
    await repository.save({ values: ['current'] })

    const document = JSON.parse(decodeSenc(storage, await readFile(filePath)))
    expect(document).toEqual({ schemaVersion: 2, values: ['current'] })
  })

  it('serializes concurrent encrypted writes', async () => {
    const { filePath, repository } = await fixture()
    await Promise.all([repository.save({ values: ['first'] }), repository.save({ values: ['second'] })])
    expect(JSON.parse(decodeSenc(storage, await readFile(filePath)))).toEqual({
      schemaVersion: 2,
      values: ['second'],
    })
  })

  it('rejects malformed decrypted data instead of replacing financial recovery state', async () => {
    const { filePath, repository } = await fixture()
    await writeSencJsonFile(filePath, storage, { values: [1] })
    await expect(repository.loadOptional()).rejects.toThrow()
  })

  it('rejects future encrypted documents without changing their bytes', async () => {
    const { filePath, repository } = await fixture()
    await writeSencJsonFile(filePath, storage, { schemaVersion: 3, values: ['future'] })
    const before = await readFile(filePath)

    await expect(repository.loadOptional()).rejects.toThrow('Unsupported schema version 3')
    expect(await readFile(filePath)).toEqual(before)
  })
})
