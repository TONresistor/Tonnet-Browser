/**
 * Builds the rows shown in the TON Connect "Sign data" approval prompt.
 * Surfaces the actual payload (size, declared cell schema, and a bounded
 * base64/BoC snippet) so the user does not blind-sign binary or cell data.
 *
 * Note: sign-data produces a detached signature over the payload, not an
 * on-chain transaction, so there is nothing to emulate. The best the wallet
 * can do is show the bytes/schema being signed.
 */
import { Buffer } from 'node:buffer'
import type { SignDataPayloadInput } from './types'

export interface ApprovalRow {
  label: string
  value: string
}

const MAX_SNIPPET = 96

/** Bound an opaque blob for display, appending its full length. */
function truncateBlob(s: string, max = MAX_SNIPPET): string {
  return s.length > max ? `${s.slice(0, max)}... (${s.length} chars)` : s
}

/** Decode a base64 string to its byte length; never throws on bad input. */
function base64ByteLength(b64: string): number {
  return Buffer.from(b64, 'base64').length
}

/** Build the informative approval rows for a sign-data request. */
export function buildSignDataRows(payload: SignDataPayloadInput): ApprovalRow[] {
  if (payload.type === 'text') {
    return [
      { label: 'Type', value: 'text' },
      { label: 'Data', value: payload.text },
    ]
  }
  if (payload.type === 'binary') {
    return [
      { label: 'Type', value: 'binary' },
      { label: 'Size', value: `${base64ByteLength(payload.bytes)} bytes` },
      { label: 'Base64', value: truncateBlob(payload.bytes) },
    ]
  }
  const rows: ApprovalRow[] = [{ label: 'Type', value: 'cell' }]
  if (payload.schema) rows.push({ label: 'Schema', value: payload.schema })
  rows.push({ label: 'Size', value: `${base64ByteLength(payload.cell)} bytes` })
  rows.push({ label: 'Cell (BoC)', value: truncateBlob(payload.cell) })
  return rows
}
