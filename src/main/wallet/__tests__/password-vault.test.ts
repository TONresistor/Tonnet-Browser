import { describe, expect, it } from 'vitest'
import { decryptWalletSecret, encryptWalletSecret, validateWalletPassword } from '../password-vault'

const secret = { type: 'mnemonic' as const, mnemonic: Array.from({ length: 24 }, (_, index) => `word${index}`) }
const publicKey = Buffer.alloc(32, 7)

describe('password wallet vault', () => {
  it('roundtrips an authenticated encrypted wallet secret', async () => {
    const envelope = await encryptWalletSecret(secret, 'correct horse battery staple', publicKey)
    expect(envelope.publicKey).toBe(publicKey.toString('hex'))
    expect(envelope.walletVersion).toBe('v5R1')
    expect(envelope.mnemonicScheme).toBe('ton')
    expect(envelope.cipher.ciphertext).not.toContain('word0')
    await expect(decryptWalletSecret(envelope, 'correct horse battery staple')).resolves.toEqual(secret)
  })

  it('fails closed for a wrong password or modified ciphertext', async () => {
    const envelope = await encryptWalletSecret(secret, 'correct horse battery staple', publicKey)
    await expect(decryptWalletSecret(envelope, 'this password is incorrect')).rejects.toThrow()
    const ciphertext = Buffer.from(envelope.cipher.ciphertext, 'base64')
    ciphertext[0] ^= 1
    await expect(
      decryptWalletSecret(
        { ...envelope, cipher: { ...envelope.cipher, ciphertext: ciphertext.toString('base64') } },
        'correct horse battery staple'
      )
    ).rejects.toThrow()
    await expect(
      decryptWalletSecret({ ...envelope, walletVersion: 'v3R1' }, 'correct horse battery staple')
    ).rejects.toThrow()
    await expect(
      decryptWalletSecret({ ...envelope, backupVerified: true }, 'correct horse battery staple')
    ).rejects.toThrow()
  })

  it('rejects weak or unbounded passwords', () => {
    expect(() => validateWalletPassword('short')).toThrow()
    expect(() => validateWalletPassword('a'.repeat(257))).toThrow()
    expect(() => validateWalletPassword('long enough password')).not.toThrow()
  })
})
