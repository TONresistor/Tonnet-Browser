export interface WalletIdentitySnapshot {
  publicKey: string
  addressRaw: string
  revision: number
}

export function sameWalletIdentity(left: WalletIdentitySnapshot | null, right: WalletIdentitySnapshot | null): boolean {
  return Boolean(
    left &&
    right &&
    left.publicKey === right.publicKey &&
    left.addressRaw === right.addressRaw &&
    left.revision === right.revision
  )
}

export class WalletIdentityTracker {
  private revision = 0

  advance(): void {
    this.revision++
  }

  snapshot(publicKey: Buffer | null, addressRaw: string | null): WalletIdentitySnapshot | null {
    if (!publicKey || !addressRaw) return null
    return { publicKey: publicKey.toString('hex'), addressRaw, revision: this.revision }
  }

  assertCurrent(current: WalletIdentitySnapshot | null, expected: WalletIdentitySnapshot): void {
    if (!sameWalletIdentity(current, expected)) throw new Error('Wallet identity changed')
  }
}
