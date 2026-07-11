import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TonConnectSessionStore, type StoredTonConnectSession } from '../session-store'

const directories: string[] = []

function stored(domain = 'app.example'): StoredTonConnectSession {
  return {
    domain,
    manifestUrl: `https://${domain}/manifest.json`,
    appName: domain,
    url: `https://${domain}`,
    address: '0:abc',
    network: '-239',
    grantedAt: 100,
    lastEventId: 0,
    lastRpcId: null,
  }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tonconnect-store-'))
  directories.push(directory)
  const filePath = join(directory, 'sessions.json')
  return { filePath, store: new TonConnectSessionStore(filePath) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('TonConnectSessionStore', () => {
  it('migrates the legacy unversioned array without losing sessions', async () => {
    const { filePath, store } = await fixture()
    await writeFile(filePath, JSON.stringify([stored('legacy.example')]))
    await store.init()

    expect(store.get('legacy.example')).toMatchObject({ appName: 'legacy.example' })
    await store.set(stored('new.example'))
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('serializes concurrent mutations into one valid final document', async () => {
    const { filePath, store } = await fixture()
    await store.init()
    await Promise.all([store.set(stored('one.example')), store.set(stored('two.example'))])

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { sessions: StoredTonConnectSession[] }
    expect(persisted.sessions.map((session) => session.domain).sort()).toEqual(['one.example', 'two.example'])
  })

  it('persists replay-protection counters before returning success', async () => {
    const { filePath, store } = await fixture()
    await store.init()
    await store.set(stored())

    await expect(store.acceptRpcId('app.example', '10')).resolves.toBe(true)
    await expect(store.acceptRpcId('app.example', '9')).resolves.toBe(false)
    await expect(store.nextEventId('app.example')).resolves.toBe(1)
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { sessions: StoredTonConnectSession[] }
    expect(persisted.sessions[0]).toMatchObject({ lastRpcId: '10', lastEventId: 1 })
  })

  it('quarantines corruption, restores an empty store, and enforces private permissions', async () => {
    const { filePath, store } = await fixture()
    await writeFile(filePath, '{broken')
    await store.init()
    expect(store.list()).toEqual([])

    const directoryEntries = await import('node:fs/promises').then((fs) => fs.readdir(join(filePath, '..')))
    expect(directoryEntries.some((name) => name.startsWith('sessions.json.corrupt-'))).toBe(true)
    if (process.platform !== 'win32') expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })
})
