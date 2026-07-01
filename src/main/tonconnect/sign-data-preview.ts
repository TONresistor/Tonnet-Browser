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
import { Cell } from '@ton/core'
import type { SignDataPayloadInput } from './types'

export interface ApprovalRow {
  label: string
  value: string
}

const MAX_SNIPPET = 96
const BASE64_RE = /^[A-Za-z0-9+/=]*$/

/** True if the string parses as a base64-encoded BoC. Never throws. */
function isValidBoc(b64: string): boolean {
  try {
    Cell.fromBase64(b64)
    return true
  } catch {
    return false
  }
}

/**
 * Validate an untrusted TON Connect sign-data payload against the spec before
 * it is previewed or signed. Guards the per-type data fields (a connected dApp
 * could omit them), so buildSignDataRows can never throw on a missing field and
 * the wallet never blind-signs `undefined`.
 *
 * Shapes (TON Connect signData):
 *   text   → { type: 'text',   text: string }
 *   binary → { type: 'binary', bytes: string (base64) }
 *   cell   → { type: 'cell',   schema: string (TL-B), cell: string (base64 BoC) }
 */
export function validateSignDataPayload(payload: unknown): payload is SignDataPayloadInput {
  if (!payload || typeof payload !== 'object') return false
  const p = payload as Record<string, unknown>
  if (p.type === 'text') return typeof p.text === 'string'
  if (p.type === 'binary') return typeof p.bytes === 'string' && BASE64_RE.test(p.bytes)
  if (p.type === 'cell') return typeof p.schema === 'string' && typeof p.cell === 'string' && isValidBoc(p.cell)
  return false
}

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
