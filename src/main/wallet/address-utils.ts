import { Address } from '@ton/core'

/**
 * Parse a raw TON address ("0:<64 hex>") to the user-friendly non-bounceable form.
 * Returns undefined if the input is missing, malformed, or unparseable.
 */
export function rawToFriendly(raw: string): string | undefined {
  if (!raw || !raw.includes(':')) return undefined
  try {
    return Address.parseRaw(raw).toString({ bounceable: false })
  } catch {
    return undefined
  }
}
