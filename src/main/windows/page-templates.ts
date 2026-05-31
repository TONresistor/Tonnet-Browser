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

/** Load a generated HTML string into a WebContents as a charset-tagged data: URL. */
export function loadDataHtml(wc: WebContents, html: string): Promise<void> {
  return wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}
