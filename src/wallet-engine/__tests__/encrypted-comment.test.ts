import { createCipheriv, createDecipheriv } from 'node:crypto'
import { Address, beginCell } from '@ton/core'
import { hmac_sha512, keyPairFromSeed } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it } from 'vitest'
import {
  createEncryptedCommentBody,
  deriveTonSharedSecret,
  ENCRYPTED_COMMENT_OP,
  parseRecipientPublicKey,
  decryptEncryptedComment,
  validateEncryptedCommentBody,
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
  const senderSeed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex')
  const recipientSeed = Buffer.from('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', 'hex')
  const senderAddress = Address.parseRaw('0:' + '11'.repeat(32))
  const sender = keyPairFromSeed(senderSeed)
  const recipient = keyPairFromSeed(recipientSeed)
  const toBody = (payload: Buffer) =>
    beginCell()
      .storeUint(ENCRYPTED_COMMENT_OP, 32)
      .storeBuffer(payload.subarray(0, 35))
      .storeRef(beginCell().storeBuffer(payload.subarray(35)).endCell())
      .endCell()
      .toBoc()
      .toString('base64')

  it('decrypts the deterministic Rust reference vector for both participants', async () => {
    const payload = Buffer.from(
      '6hqPwmryg+1H/PR0hH95hpJ5Xjz0YrWpb89Pmd3zNxYw7gaE8q0p1XqArX6+K4EhYrBs3tZH0Bj2DwAjLTLIf/BjUDsC0Z/6g4uwB59HEWA=',
      'base64'
    )
    for (const key of [sender.secretKey, recipient.secretKey])
      await expect(
        decryptEncryptedComment({ sender: senderAddress.toRawString(), body: toBody(payload) }, key)
      ).resolves.toBe('hello TON')
  })

  it.each([0, 1, 960])('decrypts %s bytes through snake cells', async (length) => {
    const body = await createEncryptedCommentBody({
      senderAddress,
      senderSecretKey: sender.secretKey,
      recipientPublicKey: recipient.publicKey,
      comment: 'a'.repeat(length),
    })
    await expect(
      decryptEncryptedComment(
        { sender: senderAddress.toString(), body: body.toBoc().toString('base64') },
        recipient.secretKey
      )
    ).resolves.toBe('a'.repeat(length))
  })

  it('rejects altered ciphertext, a wrong sender, and an unrelated wallet', async () => {
    const body = await createEncryptedCommentBody({
      senderAddress,
      senderSecretKey: sender.secretKey,
      recipientPublicKey: recipient.publicKey,
      comment: 'authenticated',
    })
    const request = { sender: senderAddress.toRawString(), body: body.toBoc().toString('base64') }
    const payload = validateEncryptedCommentBody(request.body)
    payload[payload.length - 1] ^= 1
    await expect(decryptEncryptedComment({ ...request, body: toBody(payload) }, recipient.secretKey)).rejects.toThrow(
      'authentication'
    )
    await expect(
      decryptEncryptedComment({ ...request, sender: '0:' + '33'.repeat(32) }, recipient.secretKey)
    ).rejects.toThrow('authentication')
    await expect(decryptEncryptedComment(request, keyPairFromSeed(Buffer.alloc(32, 99)).secretKey)).rejects.toThrow()
  })

  it('rejects malformed cells and lengths before decryption', () => {
    for (const body of [
      beginCell().storeUint(0, 32).endCell(),
      beginCell().storeUint(ENCRYPTED_COMMENT_OP, 32).storeBuffer(Buffer.alloc(63)).endCell(),
      beginCell().storeUint(ENCRYPTED_COMMENT_OP, 32).storeBit(true).endCell(),
      beginCell()
        .storeUint(ENCRYPTED_COMMENT_OP, 32)
        .storeRef(beginCell().endCell())
        .storeRef(beginCell().endCell())
        .endCell(),
    ])
      expect(() => validateEncryptedCommentBody(body.toBoc().toString('base64'))).toThrow()
  })

  it.each(['padding', 'utf8'] as const)('rejects authenticated invalid %s plaintext', async (invalid) => {
    const data = Buffer.alloc(32, 1)
    data[0] = invalid === 'padding' ? 1 : 16
    if (invalid === 'utf8') data[16] = 0xff
    const salt = senderAddress.toString({ bounceable: true, testOnly: false, urlSafe: true })
    const messageKey = (await hmac_sha512(salt, data)).subarray(0, 16)
    const shared = await deriveTonSharedSecret(sender.publicKey, recipientSeed)
    const derived = await hmac_sha512(shared, messageKey)
    const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
    cipher.setAutoPadding(false)
    const xor = sender.publicKey.map((byte, index) => byte ^ recipient.publicKey[index])
    const body = toBody(Buffer.concat([xor, messageKey, cipher.update(data), cipher.final()]))
    await expect(
      decryptEncryptedComment({ sender: senderAddress.toRawString(), body }, recipient.secretKey)
    ).rejects.toThrow()
  })

  it('rejects invalid or small-order Ed25519 peer points', async () => {
    await expect(deriveTonSharedSecret(Buffer.alloc(32), recipientSeed)).rejects.toThrow('Invalid peer')
    await expect(deriveTonSharedSecret(Buffer.alloc(32, 255), recipientSeed)).rejects.toThrow('Invalid peer')
  })
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
