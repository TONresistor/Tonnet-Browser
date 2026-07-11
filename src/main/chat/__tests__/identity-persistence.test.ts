import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatIdentityManager } from '../identity'

const directories: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chat-identity-'))
  directories.push(directory)
  const identity = join(directory, 'identity.json')
  const device = join(directory, 'device.dat')
  return {
    directory,
    identity,
    manager: new ChatIdentityManager({} as never, { identity, device }),
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ChatIdentityManager persistence', () => {
  it('loads the legacy identity shape and rewrites it versioned with private permissions', async () => {
    const { identity, manager } = await fixture()
    await writeFile(identity, JSON.stringify({ v: 1, domain: 'legacy.ton' }))
    await manager.clearDomain()

    expect(JSON.parse(await readFile(identity, 'utf8'))).toEqual({ schemaVersion: 1, v: 1 })
    if (process.platform !== 'win32') expect((await stat(identity)).mode & 0o777).toBe(0o600)
  })

  it('quarantines malformed attribution data instead of silently overwriting it', async () => {
    const { directory, identity, manager } = await fixture()
    await writeFile(identity, '{broken')
    await manager.clearDomain()

    expect((await readdir(directory)).some((name) => name.startsWith('identity.json.corrupt-'))).toBe(true)
    expect(JSON.parse(await readFile(identity, 'utf8'))).toEqual({ schemaVersion: 1, v: 1 })
  })
})
