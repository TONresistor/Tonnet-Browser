import { describe, expect, it } from 'vitest'
import { WalletBackupVerifier } from '../backup-verifier'

const mnemonic = Array.from({ length: 12 }, (_, index) => `word${index}`)
const walletIdentity = 'wallet-a'

describe('WalletBackupVerifier', () => {
  it('validates a random one-time challenge', () => {
    const verifier = new WalletBackupVerifier()
    const challenge = verifier.create(mnemonic, walletIdentity, 1_000)
    expect(challenge.indexes).toHaveLength(3)
    const answers = challenge.indexes.map((index) => mnemonic[index])
    expect(verifier.verify(challenge.challengeId, walletIdentity, answers, 2_000)).toBe(true)
    expect(verifier.verify(challenge.challengeId, walletIdentity, answers, 2_000)).toBe(false)
  })

  it('rejects wrong or expired answers', () => {
    const verifier = new WalletBackupVerifier()
    const wrong = verifier.create(mnemonic, walletIdentity, 1_000)
    expect(verifier.verify(wrong.challengeId, walletIdentity, ['bad', 'bad', 'bad'], 2_000)).toBe(false)
    const expired = verifier.create(mnemonic, walletIdentity, 1_000)
    expect(
      verifier.verify(
        expired.challengeId,
        walletIdentity,
        expired.indexes.map((index) => mnemonic[index]),
        400_000
      )
    ).toBe(false)
  })

  it('binds a challenge to one wallet and clears pending challenges', () => {
    const verifier = new WalletBackupVerifier()
    const wrongWallet = verifier.create(mnemonic, walletIdentity, 1_000)
    const wrongWalletAnswers = wrongWallet.indexes.map((index) => mnemonic[index])
    expect(verifier.verify(wrongWallet.challengeId, 'wallet-b', wrongWalletAnswers, 2_000)).toBe(false)

    const cleared = verifier.create(mnemonic, walletIdentity, 1_000)
    const clearedAnswers = cleared.indexes.map((index) => mnemonic[index])
    verifier.clear()
    expect(verifier.verify(cleared.challengeId, walletIdentity, clearedAnswers, 2_000)).toBe(false)
  })
})
