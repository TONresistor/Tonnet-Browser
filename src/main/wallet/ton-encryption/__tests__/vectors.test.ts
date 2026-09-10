/**
 * Known-answer tests for the ton-simple-v2 envelope.
 *
 * vectors.json is shared verbatim with the other TON implementations. Because
 * msgKey derives from the padded plaintext, output is only reproducible when
 * the random prefix is fixed, so each case pins the prefix and the encrypt
 * path takes an injectable random source.
 *
 * A failure here means the wire format changed. That is a breaking change for
 * every counterparty, not just for this repository.
 */

import { keyPairFromSeed } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { describe, expect, it } from 'vitest'
import { encodeEncryptedCommentBody } from '../comment-body'
import { decryptEnvelope, encryptEnvelope, envelopeLengthFor } from '../envelope'
import vectors from './vectors.json'

const senderSeed = Buffer.from(vectors.senderSeedHex, 'hex')
const recipientSeed = Buffer.from(vectors.recipientSeedHex, 'hex')
const sender = keyPairFromSeed(senderSeed)
const recipient = keyPairFromSeed(recipientSeed)
const senderAddress = WalletContractV5R1.create({ publicKey: sender.publicKey, workchain: 0 }).address

/** Rebuild the pinned prefix; encrypt overwrites byte 0 with the length. */
function pinnedPrefix(prefixSeed: number) {
  return (size: number) => Buffer.from(Array.from({ length: size }, (_, index) => (prefixSeed + index) & 0xff))
}

describe('ton-simple-v2 known-answer vectors', () => {
  it('derives the pinned identities from the pinned seeds', () => {
    expect(Buffer.from(sender.publicKey).toString('hex')).toBe(vectors.senderPublicKeyHex)
    expect(Buffer.from(recipient.publicKey).toString('hex')).toBe(vectors.recipientPublicKeyHex)
    expect(senderAddress.toString({ bounceable: true, testOnly: false, urlSafe: true })).toBe(vectors.saltAddress)
  })

  it.each(vectors.cases)('reproduces the $name envelope byte for byte', async (testCase) => {
    const plaintext = Buffer.from(testCase.plaintextHex, 'hex')

    const envelope = await encryptEnvelope({
      plaintext,
      senderAddress,
      senderSeed,
      peerPublicKey: Buffer.from(recipient.publicKey),
      randomSource: pinnedPrefix(testCase.prefixSeed),
    })

    expect(envelope.toString('base64')).toBe(testCase.envelopeBase64)
    expect(envelope.length).toBe(envelopeLengthFor(plaintext.length))
    expect(encodeEncryptedCommentBody(envelope).toBoc().toString('base64')).toBe(testCase.commentBodyBocBase64)
  })

  it.each(vectors.cases)('decrypts the pinned $name envelope', async (testCase) => {
    const plaintext = await decryptEnvelope({
      envelope: Buffer.from(testCase.envelopeBase64, 'base64'),
      senderAddress,
      recipientSeed,
    })

    expect(plaintext.toString('hex')).toBe(testCase.plaintextHex)
  })
})
