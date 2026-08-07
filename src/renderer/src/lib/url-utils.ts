/**
 * URL processing utilities for TON browser navigation
 */

import { toASCII, toUnicode } from 'punycode/'

function canonicalizeHost(host: string): string {
  try {
    return new URL(`http://${host}`).host
  } catch {
    // Preserve the existing behavior for malformed input. The main process
    // remains the authoritative navigation validator and rejects it there.
    return host
  }
}

/**
 * Process user input to generate a valid navigation URL
 * Handles TON domain auto-completion (e.g., "example" → "example.ton")
 * @param input - User input from address bar or search
 * @returns Properly formatted URL for navigation
 */
export function processNavigationInput(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  // Internal pages - pass through unchanged
  if (trimmed.startsWith('ton://')) {
    return trimmed
  }

  // Detect <64hex>.bag format -> redirect to internal storage browse
  const bagMatch = trimmed.replace(/^https?:\/\//, '').match(/^([a-fA-F0-9]{64})\.bag(\/.*)?$/)
  if (bagMatch) {
    return `ton://storage/browse/${bagMatch[1].toLowerCase()}`
  }

  // Remove protocol to analyze the domain
  const urlWithoutProtocol = trimmed.replace(/^https?:\/\//, '')

  // Split the host from any path, query, or fragment.
  const suffixIndex = urlWithoutProtocol.search(/[/?#]/)
  const hostPart = suffixIndex >= 0 ? urlWithoutProtocol.slice(0, suffixIndex) : urlWithoutProtocol
  const suffix = suffixIndex >= 0 ? urlWithoutProtocol.slice(suffixIndex) : ''

  // If no dot in hostname, append .ton (e.g., "example" → "example.ton")
  const finalHost = hostPart.includes('.') ? hostPart : `${hostPart}.ton`
  const asciiHost = canonicalizeHost(finalHost)

  // DNS and the proxy always receive the canonical ASCII/Punycode hostname.
  return `http://${asciiHost}${suffix}`
}

/**
 * Decode a canonical Punycode hostname for optional address-bar display.
 * Navigation continues to use the original ASCII URL.
 */
export function decodePunycodeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes('xn--')) return url

    const unicodeHostname = toUnicode(parsed.hostname)
    // Only display a reversible decoding of the canonical hostname.
    if (toASCII(unicodeHostname).toLowerCase() !== parsed.hostname.toLowerCase()) return url

    const schemeSeparator = url.indexOf('://')
    if (schemeSeparator < 0) return url

    const authorityStart = schemeSeparator + 3
    const authoritySuffix = url.slice(authorityStart).search(/[/?#]/)
    const authorityEnd = authoritySuffix < 0 ? url.length : authorityStart + authoritySuffix
    const hostnameIndex = url.toLowerCase().lastIndexOf(parsed.hostname.toLowerCase(), authorityEnd)
    if (hostnameIndex < authorityStart) return url
    return `${url.slice(0, hostnameIndex)}${unicodeHostname}${url.slice(hostnameIndex + parsed.hostname.length)}`
  } catch {
    return url
  }
}

/**
 * Strip http:// or https:// prefix from URL for display
 * @param url - Full URL
 * @returns URL without protocol
 */
export function stripHttpPrefix(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

/**
 * Extract hostname from URL
 * @param url - Full URL
 * @returns Hostname or first segment if parsing fails
 */
export function getHostname(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    // Fallback: strip protocol and get first segment
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}
