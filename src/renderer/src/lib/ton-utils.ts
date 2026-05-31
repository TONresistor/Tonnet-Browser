/** Network fee/gas reserve held back when sending the full balance (0.01 TON, in nanoton). */
export const TX_FEE_RESERVE_NANO = 10_000_000n

const NANO_PER_TON = 1_000_000_000n

/** Format a nanoton amount as a TON string, trimming trailing zeros (max 4 decimals). BigInt-safe. */
export function formatTonAmount(nanoTon: string): string {
  if (!nanoTon) return '0'
  try {
    const ton = BigInt(nanoTon)
    const whole = ton / NANO_PER_TON
    const frac = ton % NANO_PER_TON
    if (frac === 0n) return whole.toString()
    const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '')
    return `${whole}.${fracStr.slice(0, 4)}`
  } catch {
    return '0'
  }
}

/** Parse a decimal TON string into a nanoton string. Throws on negative/invalid input. */
export function tonToNano(ton: string): string {
  if (!ton || ton.startsWith('-')) throw new Error('Invalid amount')
  const parts = ton.split('.')
  const whole = BigInt(parts[0] || '0') * NANO_PER_TON
  if (!parts[1]) return whole.toString()
  const fracStr = parts[1].padEnd(9, '0').slice(0, 9)
  return (whole + BigInt(fracStr)).toString()
}

/**
 * Format a nanoton amount as a TON string with a fixed number of decimals
 * (rounded). BigInt-safe, unlike Number(nano)/1e9 which loses precision.
 */
export function formatTonFixed(nano: string | bigint, decimals = 2): string {
  let n: bigint
  try {
    n = BigInt(nano)
  } catch {
    return (0).toFixed(decimals)
  }
  const negative = n < 0n
  if (negative) n = -n
  const scale = 10n ** BigInt(decimals)
  const scaled = (n * scale + NANO_PER_TON / 2n) / NANO_PER_TON
  const whole = scaled / scale
  const sign = negative ? '-' : ''
  if (decimals === 0) return `${sign}${whole}`
  const frac = (scaled % scale).toString().padStart(decimals, '0')
  return `${sign}${whole}.${frac}`
}

/** Validates a TON address (EQ/UQ prefix or raw 0:hex format) */
export function isValidTonAddress(addr: string): boolean {
  if (!addr) return false
  // EQ/UQ bounceable/non-bounceable user-friendly
  if (/^[EeUu][Qq][A-Za-z0-9_-]{46}$/.test(addr)) return true
  // Raw 0:<64hex> (basechain only, reject masterchain -1:)
  if (/^0:[0-9a-fA-F]{64}$/.test(addr)) return true
  return false
}

/** Returns true if the string is a valid .ton domain (ASCII-only, label regex, <=126 chars). */
export function isTonDomain(s: string): boolean {
  if (!s) return false
  const v = s.trim().toLowerCase()
  if (!v.endsWith('.ton')) return false
  if (v.length > 126) return false
  for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) > 127) return false
  return /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ton$/.test(v)
}

/** Returns true if the input is either a valid raw TON address or a valid .ton domain. */
export function isValidRecipientInput(s: string): boolean {
  return isValidTonAddress(s) || isTonDomain(s)
}
