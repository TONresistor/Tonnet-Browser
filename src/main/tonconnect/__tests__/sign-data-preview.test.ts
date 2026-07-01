import { describe, it, expect } from 'vitest'
import { buildSignDataRows, validateSignDataPayload } from '../sign-data-preview'

const VALID_BOC = 'te6ccgEBAQEAAgAAAA=='

describe('buildSignDataRows', () => {
  it('shows the raw text for text payloads', () => {
    const rows = buildSignDataRows({ type: 'text', text: 'hello world' })
    expect(rows).toEqual([
      { label: 'Type', value: 'text' },
      { label: 'Data', value: 'hello world' },
    ])
  })

  it('surfaces size and a base64 snippet for binary payloads (no placeholder)', () => {
    // 'SGVsbG8=' decodes to 'Hello' (5 bytes)
    const rows = buildSignDataRows({ type: 'binary', bytes: 'SGVsbG8=' })
    const values = rows.map((r) => r.value)
    expect(rows[0]).toEqual({ label: 'Type', value: 'binary' })
    expect(values).toContain('5 bytes')
    expect(values).toContain('SGVsbG8=')
    expect(values).not.toContain('(binary data)')
  })

  it('surfaces schema, size and a BoC snippet for cell payloads (no placeholder)', () => {
    const rows = buildSignDataRows({ type: 'cell', schema: 'transfer#0f8a7ea5', cell: 'te6ccgEBAQEAAgAAAA==' })
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]))
    expect(byLabel.Type).toBe('cell')
    expect(byLabel.Schema).toBe('transfer#0f8a7ea5')
    expect(byLabel.Size).toMatch(/^\d+ bytes$/)
    expect(rows.map((r) => r.value)).not.toContain('(cell data)')
  })

  it('omits the schema row when the cell schema is empty', () => {
    const rows = buildSignDataRows({ type: 'cell', schema: '', cell: 'te6ccgEBAQEAAgAAAA==' })
    expect(rows.some((r) => r.label === 'Schema')).toBe(false)
  })

  it('truncates long blobs and appends the full length', () => {
    const long = 'A'.repeat(200)
    const rows = buildSignDataRows({ type: 'binary', bytes: long })
    const snippet = rows.find((r) => r.label === 'Base64')!.value
    expect(snippet.length).toBeLessThan(long.length)
    expect(snippet).toContain('(200 chars)')
  })
})

describe('validateSignDataPayload', () => {
  it('accepts well-formed text/binary/cell payloads', () => {
    expect(validateSignDataPayload({ type: 'text', text: 'hi' })).toBe(true)
    expect(validateSignDataPayload({ type: 'text', text: '' })).toBe(true)
    expect(validateSignDataPayload({ type: 'binary', bytes: 'SGVsbG8=' })).toBe(true)
    expect(validateSignDataPayload({ type: 'cell', schema: 'x#00', cell: VALID_BOC })).toBe(true)
  })

  it('rejects missing or non-string data fields (blind-sign of undefined)', () => {
    expect(validateSignDataPayload({ type: 'text' })).toBe(false)
    expect(validateSignDataPayload({ type: 'text', text: 123 })).toBe(false)
    expect(validateSignDataPayload({ type: 'binary' })).toBe(false)
    expect(validateSignDataPayload({ type: 'binary', bytes: 42 })).toBe(false)
    expect(validateSignDataPayload({ type: 'cell', cell: VALID_BOC })).toBe(false) // missing schema
    expect(validateSignDataPayload({ type: 'cell', schema: 'x', cell: 123 })).toBe(false)
  })

  it('rejects non-base64 binary and unparseable cell BoC', () => {
    expect(validateSignDataPayload({ type: 'binary', bytes: 'not base64 !!!' })).toBe(false)
    expect(validateSignDataPayload({ type: 'cell', schema: 'x', cell: 'not-a-boc' })).toBe(false)
  })

  it('rejects unknown types and non-objects', () => {
    expect(validateSignDataPayload({ type: 'other', text: 'x' })).toBe(false)
    expect(validateSignDataPayload(null)).toBe(false)
    expect(validateSignDataPayload('text')).toBe(false)
    expect(validateSignDataPayload(undefined)).toBe(false)
  })
})
