/**
 * SSRF guard: classify a URL hostname as loopback / private / link-local /
 * unique-local so untrusted tonsite requests can never reach LAN, localhost
 * daemons, or cloud-metadata endpoints. Pure (no electron), so it is unit
 * tested directly.
 */

/**
 * True if the IPv4 (a.b.*.*) falls in a loopback/private/link-local range.
 * Covers 127/8, 0/8, RFC1918 (10/8, 172.16/12, 192.168/16), link-local
 * 169.254/16 (incl. the 169.254.169.254 cloud-metadata IP) and CGNAT 100.64/10.
 */
export function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 127 ||
    a === 0 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

/**
 * Block requests to loopback, private (RFC1918), link-local and unique-local
 * hosts. Installed on every tonsite session, so it also covers the TON Connect
 * manifest/icon fetch (which runs on the sender session).
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // localhost and subdomains
  if (h === 'localhost' || h.endsWith('.localhost')) return true

  // IPv6 loopback / unspecified
  if (h === '::1' || h === '::') return true

  // IPv6-mapped IPv4 (::ffff:a.b.c.d or hex ::ffff:7f00:1)
  // new URL('http://[::ffff:127.0.0.1]/').hostname returns '::ffff:7f00:1'
  if (h.startsWith('::ffff:')) {
    const suffix = h.slice(7)
    const hexMatch = suffix.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMatch) {
      const high = parseInt(hexMatch[1], 16)
      if (isPrivateIPv4(high >> 8, high & 0xff)) return true
    }
    const dottedMatch = suffix.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (dottedMatch) {
      if (isPrivateIPv4(parseInt(dottedMatch[1], 10), parseInt(dottedMatch[2], 10))) return true
    }
  }

  // IPv6 link-local (fe80::/10) and unique-local (fc00::/7)
  if (h.includes(':') && (/^fe[89ab]/.test(h) || /^f[cd]/.test(h))) return true

  // IPv4 literal
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4Match) {
    return isPrivateIPv4(parseInt(ipv4Match[1], 10), parseInt(ipv4Match[2], 10))
  }

  return false
}
