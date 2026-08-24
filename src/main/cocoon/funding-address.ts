import { Address } from '@ton/core'

/**
 * The owner wallet is not deployed before its first deposit, so the funding
 * address exposed to the UI must explicitly disable bouncing.
 */
export function toCocoonFundingAddress(address: string): string {
  return Address.parse(address).toString({ bounceable: false, urlSafe: true })
}
