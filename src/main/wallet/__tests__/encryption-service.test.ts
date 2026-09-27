import { Address } from '@ton/core'
import { keyPairFromSeed } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it, vi } from 'vitest'
import { WalletEncryptionService } from '../encryption-service'
import { createEncryptedCommentBody } from '../encrypted-comment'
import type { WalletIdentitySnapshot } from '../wallet-identity'
import vectors from '../ton-encryption/__tests__/vectors.json'

const senderSeed = Buffer.from(vectors.senderSeedHex, 'hex')
const recipientSeed = Buffer.from(vectors.recipientSeedHex, 'hex')
const senderKey = keyPairFromSeed(senderSeed)
const recipientKey = keyPairFromSeed(recipientSeed)
const senderAddress = WalletContractV5R1.create({ publicKey: senderKey.publicKey, workchain: 0 }).address
const recipientAddress = WalletContractV5R1.create({ publicKey: recipientKey.publicKey, workchain: 0 }).address
const identity: WalletIdentitySnapshot = {
  publicKey: 'aa'.repeat(32),
  addressRaw: recipientAddress.toRawString(),
  revision: 1,
}

function signingContext(address: Address, secretKey: Buffer) {
  const withSigningState = vi.fn(
    async (_identity: WalletIdentitySnapshot, operation: (addr: Address, key: Buffer) => Promise<unknown>) =>
      operation(address, secretKey)
  )
  return { withSigningState } as unknown as ConstructorParameters<typeof WalletEncryptionService>[0] & {
    withSigningState: typeof withSigningState
  }
}

/** A context that unlocks as `recipientSeed`, i.e. the receiving wallet. */
function recipientContext() {
  return signingContext(recipientAddress, recipientSeed)
}

async function encryptedMemo(comment: string): Promise<string> {
  const body = await createEncryptedCommentBody({
    senderAddress,
    senderSecretKey: senderSeed,
    recipientPublicKey: recipientKey.publicKey,
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

  it('round-trips a raw TON Connect envelope for the pinned identities', async () => {
    const senderIdentity: WalletIdentitySnapshot = {
      publicKey: vectors.senderPublicKeyHex,
      addressRaw: senderAddress.toRawString(),
      revision: 1,
    }
    const recipientIdentity: WalletIdentitySnapshot = {
      publicKey: vectors.recipientPublicKeyHex,
      addressRaw: recipientAddress.toRawString(),
      revision: 1,
    }
    const encryptService = new WalletEncryptionService(signingContext(senderAddress, senderSeed))
    const decryptService = new WalletEncryptionService(signingContext(recipientAddress, recipientSeed))
    const plaintext = Buffer.from('binary key wrap', 'utf8')

    const encrypted = await encryptService.encryptTonConnectPayload(plaintext, recipientKey.publicKey, senderIdentity)
    const recovered = await decryptService.decryptTonConnectPayload(
      Buffer.from(encrypted, 'base64'),
      vectors.saltAddress,
      recipientIdentity
    )

    expect(recovered.toString('utf8')).toBe('binary key wrap')
  })
})
