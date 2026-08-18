import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

describe('WalletKeyStorage password protection', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
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
})
