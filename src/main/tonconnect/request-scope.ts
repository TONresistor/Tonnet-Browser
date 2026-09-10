/**
 * The `from` and `network` fields a TON Connect request may carry.
 *
 * `from` selects which connected account performs the operation, `network`
 * pins the chain. Both are advisory in the request but binding for the wallet:
 * a dApp naming an account or chain other than the one it is connected to has
 * to be refused rather than quietly served with the wrong key.
 *
 * This is unrelated to `decryptData`'s `salt`, which names whoever encrypted a
 * payload and is usually a third party. The two are never compared.
 * See docs/ENCRYPTION.md.
 */

import { Address } from '@ton/core'
import { TON_MAINNET_CHAIN } from './types'

export interface RequestScope {
  from?: string
  network?: string
}

/**
 * Validate the account and chain a request targets. Returns an error message,
 * or null when the request is in scope. `from` is only enforced when the
 * wallet actually has an account to compare against.
 */
export function checkFromAndNetwork(scope: RequestScope, accountAddress: string | null): string | null {
  if (scope.network && scope.network !== TON_MAINNET_CHAIN) return 'Network mismatch'
  if (scope.from && accountAddress && !sameAddress(scope.from, accountAddress)) return 'Invalid sender address'
  return null
}

/** Compare two addresses across the raw and user-friendly spellings. */
export function sameAddress(left: string, right: string): boolean {
  try {
    return parseAnyAddress(left).equals(parseAnyAddress(right))
  } catch {
    return false
  }
}

/** Parse either spelling of a TON address. Throws when neither parses. */
export function parseAnyAddress(value: string): Address {
  try {
    return Address.parseFriendly(value).address
  } catch {
    return Address.parseRaw(value)
  }
}
