/**
 * Client-side id generators. Single source so stores don't each reinvent one.
 */

/** Full RFC-4122 UUID. Use for persisted records (bookmarks, chats). */
export function newId(): string {
  return crypto.randomUUID()
}

/** Short 7-char id (hex slice of a UUID) for compact, session-scoped ids like tab ids. */
export function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 7)
}
