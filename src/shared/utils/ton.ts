/**
 * Canonical .ton domain validation, shared between the main and renderer
 * processes so the rule lives in exactly one place.
 */

/** Label regex for a .ton domain (ASCII labels, each <=63 chars). */
export const TON_DOMAIN_REGEX = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ton$/

/** True if the string is a valid .ton domain (ASCII-only, label regex, <=126 chars). */
export function isTonDomain(s: string): boolean {
  if (!s) return false
  const v = s.trim().toLowerCase()
  if (!v.endsWith('.ton')) return false
  if (v.length > 126) return false
  for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) > 127) return false
  return TON_DOMAIN_REGEX.test(v)
}
