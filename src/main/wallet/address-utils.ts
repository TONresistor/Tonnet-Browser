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

export function parseTransferTarget(value: string): { address: Address; bounce: boolean } {
  const friendly = tryParseFriendly(value)
  if (friendly) {
    if (friendly.isTestOnly) throw new Error('Testnet address not allowed on mainnet')
    return { address: friendly.address, bounce: friendly.isBounceable }
  }
  return { address: Address.parseRaw(value), bounce: false }
}

export function parseMainnetAddress(value: string): Address {
  const friendly = tryParseFriendly(value)
  if (friendly) {
    if (friendly.isTestOnly) throw new Error('Testnet address not allowed on mainnet')
    return friendly.address
  }
  return Address.parseRaw(value)
}

function tryParseFriendly(value: string): ReturnType<typeof Address.parseFriendly> | null {
  try {
    return Address.parseFriendly(value)
  } catch {
    return null
  }
}
