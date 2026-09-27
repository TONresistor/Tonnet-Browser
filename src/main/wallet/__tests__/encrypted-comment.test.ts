import { keyPairFromSeed } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it } from 'vitest'
import {
  createEncryptedCommentBody,
  decodeEncryptedCommentBody,
  decryptCommentBody,
  decryptEnvelope,
  ENCRYPTED_COMMENT_OP,
  isEncryptedCommentBody,
  parseRecipientPublicKey,
} from '../encrypted-comment'
import { addressSalt } from '../ton-encryption/envelope'

const senderSeed = Buffer.alloc(32, 1)
const recipientSeed = Buffer.alloc(32, 2)
const sender = keyPairFromSeed(senderSeed)
const recipient = keyPairFromSeed(recipientSeed)
const senderAddress = WalletContractV5R1.create({ publicKey: sender.publicKey, workchain: 0 }).address

async function encryptedBody(comment: string | Buffer) {
  return createEncryptedCommentBody({
    senderAddress,
    senderSecretKey: sender.secretKey,
    recipientPublicKey: Buffer.from(recipient.publicKey),
    comment,
  })
}

describe('TON encrypted comments', () => {
  it('builds a standard payload the recipient key can decrypt', async () => {
    const comment = 'private memo 🔒'
    const body = await encryptedBody(comment)
    const payload = decodeEncryptedCommentBody(body.toBoc().toString('base64'))!

    expect(body.beginParse().loadUint(32)).toBe(ENCRYPTED_COMMENT_OP)
    expect(payload.subarray(0, 32).map((byte, index) => byte ^ recipient.publicKey[index])).toEqual(sender.publicKey)

    const plaintext = await decryptEnvelope({
      envelope: payload,
      senderAddress,
      recipientSeed,
    })
    expect(plaintext.toString('utf8')).toBe(comment)
  })

  it('binds the ciphertext to the sender address through msgKey', async () => {
    const body = await encryptedBody('salted')
    const payload = decodeEncryptedCommentBody(body.toBoc().toString('base64'))!
    const msgKey = payload.subarray(32, 48)

    // The recipient recomputes msgKey over the recovered padded plaintext; a
    // different sender address must not reproduce it.
    const otherAddress = WalletContractV5R1.create({ publicKey: recipient.publicKey, workchain: 0 }).address
    await expect(decryptEnvelope({ envelope: payload, senderAddress: otherAddress, recipientSeed })).rejects.toThrow(
      'authentication failed'
    )

    expect(addressSalt(senderAddress)).not.toEqual(addressSalt(otherAddress))
    expect(msgKey).toHaveLength(16)
  })

  it('rejects a tampered ciphertext', async () => {
    const body = await encryptedBody('tamper me')
    const payload = decodeEncryptedCommentBody(body.toBoc().toString('base64'))!
    payload[payload.length - 1] ^= 0xff

    await expect(decryptEnvelope({ envelope: payload, senderAddress, recipientSeed })).rejects.toThrow(
      'authentication failed'
    )
  })

  it('round-trips binary payloads without UTF-8 mangling', async () => {
    const binary = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x01, 0xc0])
    const body = await encryptedBody(binary)
    const payload = decodeEncryptedCommentBody(body.toBoc().toString('base64'))!

    const plaintext = await decryptEnvelope({ envelope: payload, senderAddress, recipientSeed })
    expect(plaintext).toEqual(binary)
  })

  it('chunks long comments across reference cells and recovers them', async () => {
    const comment = 'x'.repeat(600)
    const body = await encryptedBody(comment)

    expect(body.refs.length).toBe(1)
    const decrypted = await decryptCommentBody({
      body: body.toBoc().toString('base64'),
      senderAddress,
      recipientSecretKey: Buffer.from(recipient.secretKey),
    })
    expect(decrypted).toBe(comment)
  })

  it('pads to the AES block size with at least 16 random bytes', async () => {
    for (const length of [0, 1, 15, 16, 17, 31, 32]) {
      const body = await encryptedBody(Buffer.alloc(length, 7))
      const payload = decodeEncryptedCommentBody(body.toBoc().toString('base64'))!
      const ciphertext = payload.subarray(48)
      expect(ciphertext.length % 16).toBe(0)
      expect(ciphertext.length - length).toBeGreaterThanOrEqual(16)
    }
  })

  it('produces a different ciphertext each time for the same comment', async () => {
    const first = decodeEncryptedCommentBody((await encryptedBody('same')).toBoc().toString('base64'))!
    const second = decodeEncryptedCommentBody((await encryptedBody('same')).toBoc().toString('base64'))!

    // The random prefix is what keeps repeated memos from being recognizable.
    expect(first.subarray(32)).not.toEqual(second.subarray(32))
    expect(first.subarray(0, 32)).toEqual(second.subarray(0, 32))
  })

  it('refuses a comment larger than the module ceiling', async () => {
    await expect(encryptedBody('x'.repeat(961))).rejects.toThrow('<= 960 bytes')
  })

  it('rejects a recipient key that is not a curve point', async () => {
    await expect(
      createEncryptedCommentBody({
        senderAddress,
        senderSecretKey: sender.secretKey,
        recipientPublicKey: Buffer.alloc(32, 0xff),
        comment: 'nope',
      })
    ).rejects.toThrow()
  })

  it('identifies encrypted bodies and ignores everything else', async () => {
    const body = await encryptedBody('tagged')
    const encoded = body.toBoc().toString('base64')

    expect(isEncryptedCommentBody(encoded)).toBe(true)
    expect(isEncryptedCommentBody(undefined)).toBe(false)
    expect(isEncryptedCommentBody('not base64 at all!!')).toBe(false)
    expect(decodeEncryptedCommentBody('not base64 at all!!')).toBeUndefined()
  })

  it('parses and left-pads the bridge get_public_key result', () => {
    expect(parseRecipientPublicKey({ stack: ['1'], exit_code: 0 })).toEqual(
      Buffer.concat([Buffer.alloc(31), Buffer.from([1])])
    )
    expect(() => parseRecipientPublicKey({ stack: [], exit_code: 0 })).toThrow('invalid stack')
    expect(() => parseRecipientPublicKey({ stack: ['1'], exit_code: 5 })).toThrow('exit_code=5')
  })
})
