import { randomInt, randomUUID } from 'node:crypto'

interface PendingChallenge {
  walletIdentity: string
  expected: string[]
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

export class WalletBackupVerifier {
  private readonly pending = new Map<string, PendingChallenge>()

  create(mnemonic: string[], walletIdentity: string, now = Date.now()): { challengeId: string; indexes: number[] } {
    if (mnemonic.length !== 12 && mnemonic.length !== 24) throw new Error('Unsupported mnemonic length')
    if (!walletIdentity) throw new Error('Wallet identity is required')
    this.cleanup(now)
    const indexes = new Set<number>()
    while (indexes.size < 3) indexes.add(randomInt(mnemonic.length))
    const sorted = [...indexes].sort((a, b) => a - b)
    const challengeId = randomUUID()
    const expected = sorted.map((index) => mnemonic[index])
    const timer = setTimeout(() => {
      expected.fill('')
      this.pending.delete(challengeId)
    }, 5 * 60_000)
    timer.unref?.()
    this.pending.set(challengeId, { walletIdentity, expected, expiresAt: now + 5 * 60_000, timer })
    return { challengeId, indexes: sorted }
  }

  verify(challengeId: string, walletIdentity: string, answers: string[], now = Date.now()): boolean {
    const challenge = this.pending.get(challengeId)
    this.pending.delete(challengeId)
    if (!challenge) return false
    clearTimeout(challenge.timer)
    const valid =
      challenge.expiresAt >= now &&
      challenge.walletIdentity === walletIdentity &&
      answers.length === challenge.expected.length &&
      answers.every((answer, index) => answer.trim().toLowerCase() === challenge.expected[index])
    challenge.expected.fill('')
    return valid
  }

  clear(): void {
    for (const challenge of this.pending.values()) {
      clearTimeout(challenge.timer)
      challenge.expected.fill('')
    }
    this.pending.clear()
  }

  private cleanup(now: number): void {
    for (const [id, challenge] of this.pending) {
      if (challenge.expiresAt >= now) continue
      clearTimeout(challenge.timer)
      challenge.expected.fill('')
      this.pending.delete(id)
    }
  }
}
