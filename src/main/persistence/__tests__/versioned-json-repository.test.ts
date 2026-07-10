import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { VersionedJsonRepository } from '../versioned-json-repository'

const directories: string[] = []
const DataSchema = z.object({ names: z.array(z.string()) })

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'tonnet-repository-'))
  directories.push(directory)
  const filePath = join(directory, 'data.json')
  return {
    filePath,
    repository: new VersionedJsonRepository({
      filePath,
      version: 2,
      schema: DataSchema,
      defaults: () => ({ names: ['default'] }),
      migrate: (raw) => {
        const value = raw as { state?: { names?: string[] }; names?: string[] }
        return { names: value.state?.names ?? value.names ?? [] }
      },
    }),
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('VersionedJsonRepository', () => {
  it('creates and persists defaults for a missing file', async () => {
    const { filePath, repository: store } = await repository()
    await expect(store.load()).resolves.toEqual({ names: ['default'] })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ schemaVersion: 2, names: ['default'] })
  })

  it('migrates an older persisted shape before validation', async () => {
    const { filePath, repository: store } = await repository()
    await writeFile(filePath, JSON.stringify({ state: { names: ['legacy'] } }))
    await expect(store.load()).resolves.toEqual({ names: ['legacy'] })
  })

  it('serializes concurrent writes and leaves the final complete document', async () => {
    const { filePath, repository: store } = await repository()
    await Promise.all([store.save({ names: ['first'] }), store.save({ names: ['second'] })])
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ schemaVersion: 2, names: ['second'] })
  })

  it('rejects data that does not satisfy the repository schema', async () => {
    const { repository: store } = await repository()
    await expect(store.save({ names: [1] } as never)).rejects.toThrow()
  })

  it('rejects a future schema version without quarantining or overwriting it', async () => {
    const { filePath, repository: store } = await repository()
    const future = JSON.stringify({ schemaVersion: 3, names: ['future'] })
    await writeFile(filePath, future)

    await expect(store.load()).rejects.toThrow('Unsupported schema version 3')
    expect(await readFile(filePath, 'utf8')).toBe(future)
  })

  it('can quarantine a corrupt document before restoring defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tonnet-repository-'))
    directories.push(directory)
    const filePath = join(directory, 'data.json')
    const backupPath = `${filePath}.corrupt-123`
    await writeFile(filePath, '{broken')
    const onCorrupt = vi.fn()
    const store = new VersionedJsonRepository({
      filePath,
      version: 1,
      schema: DataSchema,
      defaults: () => ({ names: ['recovered'] }),
      migrate: (raw) => raw,
      corruption: 'reset-with-backup',
      now: () => 123,
      onCorrupt,
    })

    await expect(store.load()).resolves.toEqual({ names: ['recovered'] })
    expect(await readFile(backupPath, 'utf8')).toBe('{broken')
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ schemaVersion: 1, names: ['recovered'] })
    expect(onCorrupt).toHaveBeenCalledWith(expect.any(SyntaxError), backupPath)
  })
})
