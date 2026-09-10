/**
 * On-demand decryption of encrypted transfer memos.
 *
 * Kept out of the history read path on purpose: recovering a memo needs the
 * signing key, which is unavailable while the wallet is locked, and history
 * sync runs unattended in the background. The renderer asks for one memo at a
 * time instead. See docs/ENCRYPTION.md.
 */

import type { Address } from '@ton/core'
import { decryptCommentBody } from './encrypted-comment'
import { parseMainnetAddress } from './address-utils'
import type { WalletIdentitySnapshot } from './wallet-identity'

export interface WalletEncryptionContext {
  withSigningState<T>(
    expectedIdentity: WalletIdentitySnapshot,
    operation: (senderAddress: Address, secretKey: Buffer) => Promise<T>
  ): Promise<T>
}

/** Key-dependent encryption work, separate from transfers and vault state. */
export class WalletEncryptionService {
  constructor(private readonly context: WalletEncryptionContext) {}

  /**
   * Recover one encrypted memo.
   *
   * `senderAddress` must be whoever encrypted the payload — the counterparty
   * for a received transfer, our own address for one we sent — because it is
   * the KDF salt, not merely a label. A wrong address fails the integrity
   * check rather than returning garbage.
   */
  async decryptComment(body: string, senderAddress: string, expectedIdentity: WalletIdentitySnapshot): Promise<string> {
    // Bridges and indexers hand back raw addresses; the salt is always the
    // bounceable URL-safe form, which addressSalt() applies for us.
    const sender = parseMainnetAddress(senderAddress)
    return this.context.withSigningState(expectedIdentity, (_ownAddress, secretKey) =>
      decryptCommentBody({ body, senderAddress: sender, recipientSecretKey: secretKey })
    )
  }
}
