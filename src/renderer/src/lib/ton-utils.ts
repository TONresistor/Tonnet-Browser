/** Validates a TON address (EQ/UQ prefix or raw 0:hex format) */
export function isValidTonAddress(addr: string): boolean {
  if (!addr) return false
  // EQ/UQ bounceable/non-bounceable user-friendly
  if (/^[EeUu][Qq][A-Za-z0-9_-]{46}$/.test(addr)) return true
  // Raw 0:<64hex>
  if (/^(-1|0):[0-9a-fA-F]{64}$/.test(addr)) return true
  return false
}
