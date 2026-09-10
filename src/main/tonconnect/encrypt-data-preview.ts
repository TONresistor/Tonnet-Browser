/**
 * Validation and approval rows for the TON Connect encryptData and decryptData
 * prompts.
 *
 * Neither method moves value, so there is nothing to emulate; the wallet can
 * only show what it is being asked to operate on. For encryption that is the
 * plaintext size and the recipient key, and for decryption it is the sender
 * address the payload claims, since that address is authenticated by the
 * envelope and is the one piece of provenance the user can judge.
 */

import { Buffer } from 'node:buffer'
import { Address } from '@ton/core'
import type { ApprovalRow } from './sign-data-preview'
import type { DecryptDataPayloadInput, EncryptDataPayloadInput } from './types'

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const HEX64_RE = /^[0-9a-fA-F]{64}$/

/** Largest plaintext accepted for encryption, matching the memo module. */
export const MAX_ENCRYPT_PLAINTEXT_BYTES = 960
/** Largest envelope accepted for decryption; header plus a padded plaintext. */
export const MAX_DECRYPT_ENVELOPE_BYTES = 1_024

function isBase64(value: unknown): value is string {
  return typeof value === 'string' && BASE64_RE.test(value) && value.length % 4 === 0
}

function isAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    Address.parseFriendly(value)
    return true
  } catch {
    try {
      Address.parseRaw(value)
      return true
    } catch {
      return false
    }
  }
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

/** Decode a base64 string to its byte length; never throws on bad input. */
function base64ByteLength(value: string): number {
  return Buffer.from(value, 'base64').length
}

export function validateEncryptDataPayload(payload: unknown): payload is EncryptDataPayloadInput {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  if (!isBase64(candidate.bytes)) return false
  if (base64ByteLength(candidate.bytes) > MAX_ENCRYPT_PLAINTEXT_BYTES) return false
  if (!HEX64_RE.test(String(candidate.recipientPublicKey))) return false
  return optionalString(candidate.from) && optionalString(candidate.network)
}

export function validateDecryptDataPayload(payload: unknown): payload is DecryptDataPayloadInput {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as Record<string, unknown>
  if (!isBase64(candidate.encrypted)) return false
  const length = base64ByteLength(candidate.encrypted)
  if (length === 0 || length > MAX_DECRYPT_ENVELOPE_BYTES) return false
  // The salt is a KDF input, so it only has to be a parseable address. It is
  // deliberately not compared against `from` or the connected wallet.
  if (!isAddress(candidate.salt)) return false
  return optionalString(candidate.from) && optionalString(candidate.network)
}

function shortKey(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-8)}`
}

function shortAddress(value: string): string {
  let normalized = value
  try {
    normalized = Address.parse(value).toString({ bounceable: false })
  } catch {
    // Keep the already validated input for presentation.
  }
  return normalized.length > 14 ? `${normalized.slice(0, 6)}…${normalized.slice(-4)}` : normalized
}

export function buildEncryptDataRows(payload: EncryptDataPayloadInput): ApprovalRow[] {
  return [
    { label: 'Size', value: `${base64ByteLength(payload.bytes)} bytes` },
    { label: 'Recipient key', value: shortKey(payload.recipientPublicKey) },
  ]
}

export function buildDecryptDataRows(payload: DecryptDataPayloadInput): ApprovalRow[] {
  return [
    { label: 'Size', value: `${base64ByteLength(payload.encrypted)} bytes` },
    { label: 'Encrypted by', value: shortAddress(payload.salt) },
  ]
}
