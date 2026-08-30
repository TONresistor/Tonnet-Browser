/**
 * URL normalization utilities for TON Browser.
 * Handles tonsite:// and https:// conversions.
 */

/**
 * Normalizes URLs for TON network browsing.
 *
 * Conversions:
 * - tonsite://example → http://example (TON sites protocol)
 * - https://example → http://example (TON proxy doesn't support HTTPS tunneling)
 * - http://example → http://example (unchanged)
 *
 * @param url - URL to normalize
 * @returns Normalized URL
 */
export function normalizeUrl(url: string): string {
  if (!url) return url

  // Convert tonsite:// to http://
  if (url.startsWith('tonsite://')) {
    return url.replace('tonsite://', 'http://')
  }

  // Convert https:// to http:// (TON proxy doesn't support HTTPS)
  // Security is provided by the TON network itself
  if (url.startsWith('https://')) {
    return url.replace('https://', 'http://')
  }

  return url
}

export function cleanNavigationUrl(url: string): string {
  const queryStart = url.indexOf('?')
  const fragmentStart = url.indexOf('#')
  if (queryStart === -1 || (fragmentStart !== -1 && fragmentStart < queryStart)) return url

  const queryEnd = fragmentStart === -1 ? url.length : fragmentStart
  const parts = url.slice(queryStart + 1, queryEnd).split('&')
  const kept: string[] = []
  let changed = false

  for (const part of parts) {
    const separator = part.indexOf('=')
    const rawKey = separator === -1 ? part : part.slice(0, separator)
    let key = rawKey.toLowerCase()
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' ')).toLowerCase()
    } catch {
      key = rawKey.toLowerCase()
    }
    if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') {
      changed = true
    } else {
      kept.push(part)
    }
  }

  if (!changed) return url
  const query = kept.length > 0 ? `?${kept.join('&')}` : ''
  return `${url.slice(0, queryStart)}${query}${url.slice(queryEnd)}`
}
