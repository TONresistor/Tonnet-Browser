import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mnemonicNew } from '@ton/crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { ISecureStorage } from '../../ports/secure-storage'
import { WalletDecryptionError, WalletKeyStorage } from '../key-storage'

class TestSecureStorage implements ISecureStorage {
  isAvailable = () => true
  encrypt = (plaintext: string) => Buffer.from(`ENC:${plaintext}`)
  decrypt = (encrypted: Buffer) => {
    const value = encrypted.toString()
    if (!value.startsWith('ENC:')) throw new Error('invalid envelope')
    return value.slice(4)
  }
  getBackendName = () => 'basic_text'
}

class DeviceSecureStorage extends TestSecureStorage {
  getBackendName = () => 'keychain'
}

describe('WalletKeyStorage password protection', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('creates new wallets with the recommended 12-word multichain mnemonic', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    const keyStorage = new WalletKeyStorage(new TestSecureStorage(), directory)
    const created = await keyStorage.generateFromMnemonic('correct horse battery staple')
    expect(created.mnemonic).toHaveLength(12)
    expect(created.mnemonicScheme).toBe('bip39')
    const expectedPublicKey = Buffer.from(created.keypair.publicKey)
    keyStorage.lock()
    expect(keyStorage.isLocked()).toBe(true)
    await expect(keyStorage.inspect()).resolves.toMatchObject({ mnemonicScheme: 'bip39', walletVersion: 'v5R1' })
    keyStorage.destroy()
    const reopened = new WalletKeyStorage(new TestSecureStorage(), directory)
    const unlocked = await reopened.load('correct horse battery staple')
    expect(unlocked.publicKey).toEqual(expectedPublicKey)
    reopened.destroy()
  })

  it('uses device protection without an app password and persists backup verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-device-'))
    directories.push(directory)
    const storage = new DeviceSecureStorage()
    const keyStorage = new WalletKeyStorage(storage, directory)
    const created = await keyStorage.generateFromMnemonic()
    const expectedPublicKey = Buffer.from(created.keypair.publicKey)
    await expect(keyStorage.inspect()).resolves.toMatchObject({
      passwordProtected: false,
      backupVerified: false,
      mnemonicScheme: 'bip39',
    })

    await keyStorage.markBackupVerified()
    keyStorage.destroy()
    const reopened = new WalletKeyStorage(storage, directory)
    await expect(reopened.inspect()).resolves.toMatchObject({ passwordProtected: false, backupVerified: true })
    await expect(reopened.load()).resolves.toMatchObject({ publicKey: expectedPublicKey })
    reopened.destroy()
  })

  it('rejects a device envelope whose public key does not match its secret', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-device-'))
    directories.push(directory)
    const storage = new DeviceSecureStorage()
    const keyStorage = new WalletKeyStorage(storage, directory)
    await keyStorage.generateFromMnemonic()
    keyStorage.destroy()

    const file = join(directory, 'wallet-key.dat')
    const raw = await readFile(file)
    const document = JSON.parse(storage.decrypt(raw.subarray(4)))
    document.data.publicKey = '00'.repeat(32)
    await writeFile(file, Buffer.concat([Buffer.from('SENC'), storage.encrypt(JSON.stringify(document))]))

    const reopened = new WalletKeyStorage(storage, directory)
    await expect(reopened.load()).rejects.toThrow(WalletDecryptionError)
    reopened.destroy()
  })

  it('keeps the mnemonic confidential even when Electron falls back to basic_text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    const mnemonic = await mnemonicNew(24)
    const password = 'correct horse battery staple'
    const first = new WalletKeyStorage(new TestSecureStorage(), directory)
    const imported = await first.importFromMnemonic([...mnemonic], password)
    first.lock()

    const raw = await readFile(join(directory, 'wallet-key.dat'))
    expect(raw.toString()).not.toContain(mnemonic[0])

    const reopened = new WalletKeyStorage(new TestSecureStorage(), directory)
    await expect(reopened.inspect()).resolves.toMatchObject({ passwordProtected: true, backupVerified: true })
    await expect(reopened.load('definitely the wrong password')).rejects.toThrow(WalletDecryptionError)
    const unlocked = await reopened.load(password)
    expect(unlocked.publicKey).toEqual(imported.publicKey)
    reopened.destroy()
  })

  it('preserves the previous encrypted wallet when importing a replacement version', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    const storage = new TestSecureStorage()
    const keyStorage = new WalletKeyStorage(storage, directory)
    const password = 'correct horse battery staple'
    await keyStorage.importFromMnemonic(await mnemonicNew(24), password, 'v5R1')
    keyStorage.lock()
    await keyStorage.importFromMnemonic(await mnemonicNew(24), password, 'v3R1')

    await expect(access(join(directory, 'wallet-key.dat.pre-import.bak'))).resolves.toBeUndefined()
    const reopened = new WalletKeyStorage(storage, directory)
    await expect(reopened.inspect()).resolves.toMatchObject({ walletVersion: 'v3R1', mnemonicScheme: 'ton' })
    reopened.destroy()
  })

  it('rotates the password without changing the wallet identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    const storage = new TestSecureStorage()
    const keyStorage = new WalletKeyStorage(storage, directory)
    const original = await keyStorage.importFromMnemonic(await mnemonicNew(24), 'correct horse battery staple', 'v5R1')
    keyStorage.lock()
    await keyStorage.changePassword('correct horse battery staple', 'a newer and stronger wallet password')

    const reopened = new WalletKeyStorage(storage, directory)
    await expect(reopened.load('correct horse battery staple')).rejects.toThrow(WalletDecryptionError)
    const unlocked = await reopened.load('a newer and stronger wallet password')
    expect(unlocked.publicKey).toEqual(original.publicKey)
    reopened.destroy()
  })

  it('grandfathers a legacy raw seed as backed up during password migration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    await writeFile(join(directory, 'wallet-key.dat'), Buffer.alloc(32, 9), { mode: 0o600 })
    const storage = new TestSecureStorage()
    const keyStorage = new WalletKeyStorage(storage, directory)
    await keyStorage.load()
    await keyStorage.protectWithPassword('correct horse battery staple')
    await expect(keyStorage.inspect()).resolves.toMatchObject({ passwordProtected: true, backupVerified: true })
    keyStorage.destroy()
  })
})
