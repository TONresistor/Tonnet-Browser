/**
 * Shared helpers for the internal HTML pages (file browser, storage loading/error)
 * that are rendered into a WebContentsView via a data: URL.
 */

import type { WebContents } from 'electron'

/** Escape the five HTML-significant characters so untrusted text is safe in markup. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Serialize a value to JSON safe for embedding inside an inline <script> block.
 * JSON.stringify does not escape `<`, `>` or `&`, so a string containing
 * `</script>` would break out of the script element. Escaping those (plus the
 * U+2028/U+2029 line separators that are invalid in JS string literals) as
 * `\uXXXX` keeps the value an identical string at runtime while making element
 * breakout impossible. Use this for any untrusted data interpolated into a
 * <script> tag.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Load a generated HTML string into a WebContents as a charset-tagged data: URL. */
export function loadDataHtml(wc: WebContents, html: string): Promise<void> {
  return wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}
