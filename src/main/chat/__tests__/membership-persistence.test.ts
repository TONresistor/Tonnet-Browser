import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatMembership } from '../membership'

const directories: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chat-membership-'))
  directories.push(directory)
  const filePath = join(directory, 'membership.json')
  return { directory, filePath, membership: new ChatMembership(filePath) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ChatMembership persistence', () => {
  it('loads the legacy unversioned shape and rewrites it versioned', async () => {
    const { filePath, membership } = await fixture()
    await writeFile(filePath, JSON.stringify({ v: 1, owned: { abc: 'PLN:00' }, certs: {} }))
    await expect(membership.isOwner('abc')).resolves.toBe(true)
    await membership.clear()

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ schemaVersion: 1, v: 1, owned: {}, certs: {} })
    if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('quarantines corrupt membership data before recovering defaults', async () => {
    const { directory, filePath, membership } = await fixture()
    await writeFile(filePath, '{broken')
    await expect(membership.isOwner('abc')).resolves.toBe(false)

    expect((await readdir(directory)).some((name) => name.startsWith('membership.json.corrupt-'))).toBe(true)
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 1, owned: {}, certs: {} })
  })
})
