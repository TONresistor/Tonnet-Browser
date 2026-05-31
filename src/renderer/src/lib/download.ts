/**
 * Browser file-download helpers (OPP-57).
 *
 * Centralizes the Blob + object-URL + temporary <a> click dance used to export
 * JSON from the renderer (bookmarks, themes), including the appendChild/remove
 * that some engines require for a programmatic click to fire.
 */

/** Trigger a download of `content` as a file named `filename`. */
export function downloadTextFile(content: string, filename: string, type = 'application/json'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Pretty-print `data` as JSON and download it as `filename`. */
export function downloadJson(data: unknown, filename: string): void {
  downloadTextFile(JSON.stringify(data, null, 2), filename)
}
