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

/**
 * Checks if a URL needs normalization.
 * @param url - URL to check
 * @returns True if URL will be modified by normalizeUrl()
 */
export function needsNormalization(url: string): boolean {
  return url.startsWith('tonsite://') || url.startsWith('https://')
}
