import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ISecureStorage } from '../../ports/secure-storage'
import { decodeSenc, SENC_MARKER, writeSencJsonFile } from '../../utils/senc'
import { CocoonKeyStorage, CocoonWalletDecryptionError, type CocoonWalletData } from '../wallet-storage'

const directories: string[] = []
const storage: ISecureStorage = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value, 'utf8'),
  decrypt: (value) => value.toString('utf8'),
  getBackendName: () => 'test',
}

const wallet: CocoonWalletData = {
  ownerMnemonic: Array(24).fill('word'),
  nodeSecretBase64: 'secret',
  nodePublicKeyHex: 'public',
  ownerAddress: 'owner',
  nodeAddress: 'node',
  createdAt: 1,
}

async function fixture(secureStorage = storage) {
  const directory = await mkdtemp(join(tmpdir(), 'cocoon-wallet-'))
  directories.push(directory)
  const store = new CocoonKeyStorage(secureStorage, directory)
  return { store, filePath: store.getFilePath() }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('CocoonKeyStorage versioned persistence', () => {
  it('reads a legacy SENC wallet unchanged and versions the next update', async () => {
    const { store, filePath } = await fixture()
    await writeSencJsonFile(filePath, storage, wallet)
    await expect(store.load()).resolves.toEqual(wallet)
    await store.update({ ...wallet, setupCompletedAt: 2 })

    expect(JSON.parse(decodeSenc(storage, await readFile(filePath)))).toEqual({
      schemaVersion: 1,
      ...wallet,
      setupCompletedAt: 2,
    })
  })

  it('preserves the dedicated decryption error contract', async () => {
    const failingStorage: ISecureStorage = {
      ...storage,
      decrypt: () => {
        throw new Error('keychain unavailable')
      },
    }
    const { store, filePath } = await fixture(failingStorage)
    await writeFile(filePath, Buffer.concat([SENC_MARKER, Buffer.from('ciphertext')]))
    await expect(store.load()).rejects.toBeInstanceOf(CocoonWalletDecryptionError)
  })

  it('keeps the historical null result for a non-SENC file', async () => {
    const { store, filePath } = await fixture()
    await writeFile(filePath, 'not-a-wallet')
    await expect(store.load()).resolves.toBeNull()
  })

  it('rejects a decrypted wallet that violates the runtime schema', async () => {
    const { store, filePath } = await fixture()
    await writeSencJsonFile(filePath, storage, { ownerMnemonic: [] })
    await expect(store.load()).rejects.toThrow('Invalid schema')
  })
})
