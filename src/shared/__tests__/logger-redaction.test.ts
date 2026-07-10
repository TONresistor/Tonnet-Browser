import { describe, expect, it } from 'vitest'
import { redactLogValue } from '../logger'

describe('central log redaction', () => {
  it('redacts secret-bearing fields recursively without mutating safe metadata', () => {
    const value = redactLogValue({
      subsystem: 'wallet',
      operation: 'sign',
      nested: {
        mnemonic: 'one two three',
        privateKey: 'deadbeef',
        token: 'opaque',
        address: 'EQ-safe',
      },
    })

    expect(value).toEqual({
      subsystem: 'wallet',
      operation: 'sign',
      nested: {
        mnemonic: '[REDACTED]',
        privateKey: '[REDACTED]',
        token: '[REDACTED]',
        address: 'EQ-safe',
      },
    })
  })

  it('redacts labeled secrets, authorization material, BOCs, and raw binary data', () => {
    const fullBoc = `te6cc${'A'.repeat(48)}`
    const fullHex = 'ab'.repeat(80)
    const text = redactLogValue(`authorization=Bearer abc.def seed:correct-horse boc=${fullBoc} payload=${fullHex}`)

    expect(text).not.toContain('abc.def')
    expect(text).not.toContain('correct-horse')
    expect(text).not.toContain(fullBoc)
    expect(text).not.toContain(fullHex)
    expect(redactLogValue(Buffer.from('secret'))).toBe('[Binary 6 bytes]')
  })

  it('sanitizes errors and circular values', () => {
    const circular: Record<string, unknown> = { error: new Error('token=opaque') }
    circular.self = circular

    expect(redactLogValue(circular)).toEqual({
      error: expect.objectContaining({ message: 'token=[REDACTED]' }),
      self: '[Circular]',
    })
  })
})
