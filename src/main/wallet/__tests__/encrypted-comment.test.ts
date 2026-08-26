import { createDecipheriv } from 'node:crypto'
import { hmac_sha512, keyPairFromSeed } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it } from 'vitest'
import {
  createEncryptedCommentBody,
  deriveTonSharedSecret,
  ENCRYPTED_COMMENT_OP,
  parseRecipientPublicKey,
} from '../encrypted-comment'

function loadEncryptedPayload(body: ReturnType<typeof WalletContractV5R1.create>['init']['data']): Buffer {
  const chunks: Buffer[] = []
  let slice = body.beginParse()
  expect(slice.loadUint(32)).toBe(ENCRYPTED_COMMENT_OP)
  while (true) {
    chunks.push(slice.loadBuffer(Math.floor(slice.remainingBits / 8)))
    if (slice.remainingRefs === 0) break
    slice = slice.loadRef().beginParse()
  }
  return Buffer.concat(chunks)
}

describe('TON encrypted comments', () => {
  it('builds a standard payload that the recipient key can decrypt', async () => {
    const senderSeed = Buffer.alloc(32, 1)
    const recipientSeed = Buffer.alloc(32, 2)
    const sender = keyPairFromSeed(senderSeed)
    const recipient = keyPairFromSeed(recipientSeed)
    const senderAddress = WalletContractV5R1.create({ publicKey: sender.publicKey, workchain: 0 }).address
    const comment = 'private memo 🔒'

    const body = await createEncryptedCommentBody({
      senderAddress,
      senderSecretKey: sender.secretKey,
      recipientPublicKey: recipient.publicKey,
      comment,
    })
    const payload = loadEncryptedPayload(body)
    const publicKeyXor = payload.subarray(0, 32)
    const msgKey = payload.subarray(32, 48)
    const ciphertext = payload.subarray(48)

    expect(publicKeyXor.map((byte, index) => byte ^ recipient.publicKey[index])).toEqual(sender.publicKey)
    const sharedSecret = await deriveTonSharedSecret(sender.publicKey, recipientSeed)
    const derived = await hmac_sha512(sharedSecret, msgKey)
    const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
    decipher.setAutoPadding(false)
    const paddedData = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const salt = Buffer.from(senderAddress.toString({ bounceable: true, testOnly: false, urlSafe: true }))

    expect((await hmac_sha512(salt, paddedData)).subarray(0, 16)).toEqual(msgKey)
    expect(paddedData.subarray(paddedData[0]).toString('utf8')).toBe(comment)
  })

  it('parses and left-pads the bridge get_public_key result', () => {
    expect(parseRecipientPublicKey({ stack: ['1'], exit_code: 0 })).toEqual(
      Buffer.concat([Buffer.alloc(31), Buffer.from([1])])
    )
    expect(() => parseRecipientPublicKey({ stack: [], exit_code: 0 })).toThrow('invalid stack')
    expect(() => parseRecipientPublicKey({ stack: ['1'], exit_code: 5 })).toThrow('exit_code=5')
  })
})
