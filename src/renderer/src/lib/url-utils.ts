/**
 * URL processing utilities for TON browser navigation
 */

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

  // Remove protocol to analyze the domain
  const urlWithoutProtocol = trimmed.replace(/^https?:\/\//, '')

  // Split into host and path
  const slashIndex = urlWithoutProtocol.indexOf('/')
  const hostPart = slashIndex >= 0 ? urlWithoutProtocol.slice(0, slashIndex) : urlWithoutProtocol
  const pathPart = slashIndex >= 0 ? urlWithoutProtocol.slice(slashIndex) : ''

  // If no dot in hostname, append .ton (e.g., "example" → "example.ton")
  const finalHost = hostPart.includes('.') ? hostPart : `${hostPart}.ton`

  // Navigate with http://
  return `http://${finalHost}${pathPart}`
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
