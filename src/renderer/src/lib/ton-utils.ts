/** Network fee/gas reserve held back when sending the full balance (0.01 TON, in nanoton). */
export const TX_FEE_RESERVE_NANO = 10_000_000n

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
