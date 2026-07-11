import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ISecureStorage } from '../../ports/secure-storage'
import { decodeSenc, writeSencJsonFile } from '../../utils/senc'
import { ConsumedArchive, type ArchivedCocoon } from '../consumed-archive'
import { RecoveryQueueStore, type RecoveryEntry } from '../recovery-queue'

const directories: string[] = []
const storage: ISecureStorage = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8'),
  decrypt: (value) => value.toString('utf8'),
  getBackendName: () => 'test',
}

async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'cocoon-recovery-'))
  directories.push(value)
  return value
}

function archived(archivedAt: number): ArchivedCocoon {
  return {
    archivedAt,
    ownerAddress: `owner-${archivedAt}`,
    nodeAddress: `node-${archivedAt}`,
    ownerMnemonic: Array(24).fill('word'),
    nodeSecretBase64: 'secret',
    nodePublicKeyHex: 'public',
    lastClientSCAddress: `client-${archivedAt}`,
  }
}

function recovery(archivedAt: number): RecoveryEntry {
  return {
    archivedAt,
    clientSCAddress: `client-${archivedAt}`,
    phase: 'refund-pending',
    addedAt: archivedAt,
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})

describe('Cocoon financial recovery persistence', () => {
  it('reads the legacy encrypted archive and versions the next write', async () => {
    const basePath = await directory()
    const archive = new ConsumedArchive(basePath, storage)
    await writeSencJsonFile(archive.getFilePath(), storage, { entries: [archived(1)] })
    expect(await archive.list()).toHaveLength(1)
    await archive.archive(archived(2))

    const persisted = JSON.parse(decodeSenc(storage, await readFile(archive.getFilePath())))
    expect(persisted.schemaVersion).toBe(1)
    expect(persisted.entries).toHaveLength(2)
  })

  it('serializes concurrent archive appends without losing a wallet', async () => {
    const archive = new ConsumedArchive(await directory(), storage)
    await Promise.all([archive.archive(archived(1)), archive.archive(archived(2)), archive.archive(archived(3))])
    expect((await archive.list()).map((entry) => entry.archivedAt)).toEqual([1, 2, 3])
  })

  it('serializes queue mutations and preserves duplicate protection', async () => {
    const queue = new RecoveryQueueStore(await directory(), storage)
    await Promise.all([queue.add(recovery(1)), queue.add(recovery(2))])
    await Promise.all([queue.update(1, { phase: 'cooldown', unlockTs: 123 }), queue.remove(2)])
    expect(await queue.list()).toEqual([{ ...recovery(1), phase: 'cooldown', unlockTs: 123 }])
    await expect(queue.add(recovery(1))).rejects.toThrow('already exists')
  })

  it('rejects invalid decrypted recovery state instead of replacing it', async () => {
    const basePath = await directory()
    const queue = new RecoveryQueueStore(basePath, storage)
    await writeSencJsonFile(queue.getFilePath(), storage, { entries: [{ archivedAt: 1 }] })
    await expect(queue.list()).rejects.toThrow()
  })
})
