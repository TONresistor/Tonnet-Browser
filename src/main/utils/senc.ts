/**
 * SENC envelope: the on-disk format for safeStorage-encrypted blobs.
 *
 * Layout: the 4-byte ASCII marker "SENC" followed by the safeStorage
 * ciphertext. Centralizing encode/decode (and routing writes through the
 * durable atomic writer) keeps the cocoon stores from each re-implementing the
 * marker + encrypt + tmp/rename dance, which is how the format drifted before.
 */
import { writeSecureFileAtomic } from './secure-fs'
import type { ISecureStorage } from '../ports/secure-storage'

/** 4-byte marker prefixing every safeStorage-encrypted blob this app writes. */
export const SENC_MARKER = Buffer.from('SENC')

/** Encode a plaintext JSON string as a SENC blob (marker + safeStorage ciphertext). */
export function encodeSenc(storage: ISecureStorage, json: string): Buffer {
  return Buffer.concat([SENC_MARKER, storage.encrypt(json)])
}

/**
 * Decode a SENC blob back to its plaintext JSON. Throws if the marker is
 * absent (wrong/corrupt file). `context` (e.g. the file path) is folded into
 * the error message for debugging.
 */
export function decodeSenc(storage: ISecureStorage, buf: Buffer, context?: string): string {
  if (!buf.subarray(0, 4).equals(SENC_MARKER)) {
    throw new Error(`Unexpected file format${context ? ` at ${context}` : ''} (no SENC marker)`)
  }
  return storage.decrypt(buf.subarray(4))
}

/**
 * Atomically write a JSON-serializable value as an encrypted SENC file
 * (0o600, fsync for crash durability).
 */
export async function writeSencJsonFile(filePath: string, storage: ISecureStorage, data: unknown): Promise<void> {
  await writeSecureFileAtomic(filePath, encodeSenc(storage, JSON.stringify(data)))
}
