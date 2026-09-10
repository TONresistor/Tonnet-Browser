import { describe, expect, it } from 'vitest'
import {
  buildDecryptDataRows,
  buildEncryptDataRows,
  validateDecryptDataPayload,
  validateEncryptDataPayload,
} from '../encrypt-data-preview'

describe('encrypt-data-preview', () => {
  it('accepts a well-formed encrypt payload', () => {
    const payload = {
      bytes: Buffer.from('hello', 'utf8').toString('base64'),
      recipientPublicKey: 'aa'.repeat(32),
      from: `0:${'11'.repeat(32)}`,
      network: '-239',
    }
    expect(validateEncryptDataPayload(payload)).toBe(true)
    expect(buildEncryptDataRows(payload)).toEqual([
      { label: 'Size', value: '5 bytes' },
      { label: 'Recipient key', value: 'aaaaaaaa…aaaaaaaa' },
    ])
  })

  it('rejects encrypt payloads that exceed the plaintext ceiling', () => {
    expect(
      validateEncryptDataPayload({
        bytes: Buffer.alloc(961).toString('base64'),
        recipientPublicKey: 'aa'.repeat(32),
      })
    ).toBe(false)
  })

  it('accepts decrypt payloads with a third-party salt', () => {
    const payload = {
      encrypted: Buffer.alloc(80, 7).toString('base64'),
      salt: `0:${'22'.repeat(32)}`,
      from: `0:${'11'.repeat(32)}`,
      network: '-239',
    }
    expect(validateDecryptDataPayload(payload)).toBe(true)
    expect(buildDecryptDataRows(payload)).toEqual([
      { label: 'Size', value: '80 bytes' },
      { label: 'Encrypted by', value: expect.any(String) },
    ])
  })

  it('rejects decrypt payloads with an unparseable salt', () => {
    expect(
      validateDecryptDataPayload({
        encrypted: Buffer.alloc(64).toString('base64'),
        salt: 'not-an-address',
      })
    ).toBe(false)
  })
})
