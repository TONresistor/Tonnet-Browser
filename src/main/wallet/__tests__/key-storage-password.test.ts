import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { afterEach, describe, expect, it } from 'vitest'
import type { ISecureStorage } from '../../ports/secure-storage'
import { WalletDecryptionError, WalletKeyStorage } from '../key-storage'

class TestSecureStorage implements ISecureStorage {
  failEncryption = false
  isAvailable = () => true
  encrypt = (plaintext: string) => {
    if (this.failEncryption) throw new Error('simulated secure storage failure')
    return Buffer.from(`ENC:${plaintext}`)
  }
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

async function writeV250Wallet(directory: string, storage: ISecureStorage, mnemonic: string[]): Promise<Buffer> {
  const document = JSON.stringify({ schemaVersion: 1, data: { type: 'mnemonic', mnemonic } })
  const raw = Buffer.concat([Buffer.from('SENC'), storage.encrypt(document)])
  await writeFile(join(directory, 'wallet-key.dat'), raw, { mode: 0o600 })
  return raw
}

describe('WalletKeyStorage password protection', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('creates new wallets with the official 24-word TON mnemonic by default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    const keyStorage = new WalletKeyStorage(new TestSecureStorage(), directory)
    const created = await keyStorage.generateFromMnemonic('correct horse battery staple')
    expect(created.mnemonic).toHaveLength(24)
    const expectedPublicKey = Buffer.from(created.keypair.publicKey)
    keyStorage.lock()
    expect(keyStorage.isLocked()).toBe(true)
    await expect(keyStorage.inspect()).resolves.toMatchObject({ mnemonicScheme: 'ton', walletVersion: 'v5R1' })
    keyStorage.destroy()
    const reopened = new WalletKeyStorage(new TestSecureStorage(), directory)
    const unlocked = await reopened.load('correct horse battery staple')
    expect(unlocked.publicKey).toEqual(expectedPublicKey)
    reopened.destroy()
  })

  it('upgrades an exact v2.5.0 wallet without changing its address', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-v250-upgrade-'))
    directories.push(directory)
    const storage = new TestSecureStorage()
    const mnemonic = await mnemonicNew(24)
    const expectedKeypair = await mnemonicToPrivateKey(mnemonic)
    const expectedAddress = WalletContractV5R1.create({
      publicKey: expectedKeypair.publicKey,
      workchain: 0,
    }).address.toRawString()
    expectedKeypair.publicKey.fill(0)
    expectedKeypair.secretKey.fill(0)
    const original = await writeV250Wallet(directory, storage, mnemonic)

    const current = new WalletKeyStorage(storage, directory)
    await expect(current.inspect()).resolves.toMatchObject({
      publicKey: null,
      passwordProtected: false,
      backupVerified: false,
      walletVersion: 'v5R1',
    })
    const before = await current.load()
    expect(WalletContractV5R1.create({ publicKey: before.publicKey, workchain: 0 }).address.toRawString()).toBe(
      expectedAddress
    )

    await current.protectWithPassword('correct horse battery staple')
    expect(await readFile(join(directory, 'wallet-key.dat'))).not.toEqual(original)
    await expect(access(join(directory, 'wallet-key.dat.pre-password.bak'))).rejects.toMatchObject({ code: 'ENOENT' })
    current.destroy()

    const reopened = new WalletKeyStorage(storage, directory)
    await expect(reopened.load('definitely the wrong password')).rejects.toThrow(WalletDecryptionError)
    const after = await reopened.load('correct horse battery staple')
    expect(WalletContractV5R1.create({ publicKey: after.publicKey, workchain: 0 }).address.toRawString()).toBe(
      expectedAddress
    )
    reopened.destroy()
    mnemonic.fill('')
  }, 20_000)

  it('restores the exact v2.5.0 wallet when password migration fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-v250-rollback-'))
    directories.push(directory)
    const storage = new TestSecureStorage()
    const mnemonic = await mnemonicNew(24)
    const original = await writeV250Wallet(directory, storage, mnemonic)
    const current = new WalletKeyStorage(storage, directory)
    const before = await current.load()
    const expectedPublicKey = Buffer.from(before.publicKey)

    storage.failEncryption = true
    await expect(current.protectWithPassword('correct horse battery staple')).rejects.toThrow(
      'simulated secure storage failure'
    )
    expect(await readFile(join(directory, 'wallet-key.dat'))).toEqual(original)

    storage.failEncryption = false
    current.destroy()
    const reopened = new WalletKeyStorage(storage, directory)
    await expect(reopened.load()).resolves.toMatchObject({ publicKey: expectedPublicKey })
    reopened.destroy()
    mnemonic.fill('')
  }, 15_000)

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
      mnemonicScheme: 'ton',
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
    expect(raw.toString()).not.toContain(JSON.stringify(mnemonic))

    const reopened = new WalletKeyStorage(new TestSecureStorage(), directory)
    await expect(reopened.inspect()).resolves.toMatchObject({ passwordProtected: true, backupVerified: true })
    await expect(reopened.load('definitely the wrong password')).rejects.toThrow(WalletDecryptionError)
    const unlocked = await reopened.load(password)
    expect(unlocked.publicKey).toEqual(imported.publicKey)
    reopened.destroy()
  })

  it('authenticates destructive actions against storage even while the wallet is unlocked', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ton-browser-vault-'))
    directories.push(directory)
    const keyStorage = new WalletKeyStorage(new TestSecureStorage(), directory)
    await keyStorage.importFromMnemonic(await mnemonicNew(24), 'correct horse battery staple')

    await expect(keyStorage.authenticatePassword('definitely the wrong password')).rejects.toThrow(
      WalletDecryptionError
    )
    await expect(keyStorage.authenticatePassword('correct horse battery staple')).resolves.toBeUndefined()
    keyStorage.destroy()
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
  }, 15_000)

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
