import { Address } from '@ton/core'
import { keyPairFromSeed } from '@ton/crypto'
import { describe, expect, it, vi } from 'vitest'
import { WalletEncryptionService } from '../encryption-service'
import { createEncryptedCommentBody } from '../encrypted-comment'
import type { WalletIdentitySnapshot } from '../wallet-identity'

const senderSeed = Buffer.alloc(32, 1)
const recipientSeed = Buffer.alloc(32, 2)
const senderAddress = Address.parseRaw(`0:${'11'.repeat(32)}`)
const recipientAddress = Address.parseRaw(`0:${'22'.repeat(32)}`)
const identity: WalletIdentitySnapshot = {
  publicKey: 'aa'.repeat(32),
  addressRaw: recipientAddress.toRawString(),
  revision: 1,
}

/** A context that unlocks as `recipientSeed`, i.e. the receiving wallet. */
function recipientContext() {
  const withSigningState = vi.fn(
    async (_identity: WalletIdentitySnapshot, operation: (address: Address, key: Buffer) => Promise<unknown>) =>
      operation(recipientAddress, recipientSeed)
  )
  return { withSigningState } as unknown as ConstructorParameters<typeof WalletEncryptionService>[0] & {
    withSigningState: typeof withSigningState
  }
}

async function encryptedMemo(comment: string): Promise<string> {
  const body = await createEncryptedCommentBody({
    senderAddress,
    senderSecretKey: senderSeed,
    recipientPublicKey: keyPairFromSeed(recipientSeed).publicKey,
    comment,
  })
  return body.toBoc().toString('base64')
}

describe('WalletEncryptionService', () => {
  it('recovers a memo the counterparty encrypted to us', async () => {
    const context = recipientContext()
    const service = new WalletEncryptionService(context)
    const body = await encryptedMemo('lunch money')

    await expect(service.decryptComment(body, senderAddress.toRawString(), identity)).resolves.toBe('lunch money')
  })

  it('accepts the sender address in either raw or bounceable form', async () => {
    const service = new WalletEncryptionService(recipientContext())
    const body = await encryptedMemo('same salt')

    await expect(
      service.decryptComment(body, senderAddress.toString({ bounceable: true, urlSafe: true }), identity)
    ).resolves.toBe('same salt')
  })

  it('fails closed when told the wrong sender, because the salt is authenticated', async () => {
    const service = new WalletEncryptionService(recipientContext())
    const body = await encryptedMemo('lunch money')
    const impostor = Address.parseRaw(`0:${'33'.repeat(32)}`).toRawString()

    await expect(service.decryptComment(body, impostor, identity)).rejects.toThrow(/authentication failed/)
  })

  it('rejects a body that is not an encrypted comment', async () => {
    const service = new WalletEncryptionService(recipientContext())

    await expect(service.decryptComment('not-a-boc', senderAddress.toRawString(), identity)).rejects.toThrow()
  })

  it('runs decryption under the identity guard so an account switch cannot leak plaintext', async () => {
    const context = recipientContext()
    const service = new WalletEncryptionService(context)
    const body = await encryptedMemo('guarded')

    await service.decryptComment(body, senderAddress.toRawString(), identity)

    expect(context.withSigningState).toHaveBeenCalledWith(identity, expect.any(Function))
  })
})
