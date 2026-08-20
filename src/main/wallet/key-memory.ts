export interface WalletKeypair {
  publicKey: Buffer
  secretKey: Buffer
}

export function wipeKeypair(keypair: WalletKeypair | null, except?: WalletKeypair): void {
  if (!keypair || keypair === except) return
  keypair.secretKey.fill(0)
  keypair.publicKey.fill(0)
}

export function wipePublicKey(publicKey: Buffer | null): void {
  publicKey?.fill(0)
}
