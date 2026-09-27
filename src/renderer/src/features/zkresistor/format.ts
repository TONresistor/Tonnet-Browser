export function formatTokenUnits(raw: string, decimals: number): string {
  if (decimals === 0) return BigInt(raw).toLocaleString('en-US')
  const padded = raw.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '').slice(0, 4)
  const formattedWhole = BigInt(whole).toLocaleString('en-US')
  return fraction ? `${formattedWhole}.${fraction}` : formattedWhole
}

export function zkResistorPoolUrl(address: string): string {
  return `ton://zkr/pool/${encodeURIComponent(address)}`
}
