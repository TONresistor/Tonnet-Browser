/**
 * Pure parsing for the in-app tabular file viewer (ton://storage/view/<bag>/<path>).
 * Turns CSV/TSV/JSONL text into a column + row grid so the viewer can render a
 * real table instead of dumping raw text. Kept pure and tested so the React
 * page stays thin.
 */

export type TableFormat = 'csv' | 'tsv' | 'jsonl'

export interface TableData {
  format: TableFormat
  columns: string[]
  rows: string[][]
  /** Number of data rows dropped because the row cap was hit. */
  truncatedRows: number
  /** Number of columns dropped because the column cap was hit. */
  truncatedCols: number
}

/** Hard cap on columns so a malicious bag with thousands of distinct keys can't
 *  blow up the DOM / materialize an O(rows×cols) grid in the renderer. */
export const MAX_TABLE_COLS = 200

const FORMAT_BY_EXT: Record<string, TableFormat> = {
  csv: 'csv',
  tsv: 'tsv',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
}

/** The tabular format for a file name, or null if it is not a table. */
export function tableFormat(name: string): TableFormat | null {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return FORMAT_BY_EXT[ext] ?? null
}

export function isTabularFile(name: string): boolean {
  return tableFormat(name) !== null
}

/** Split delimited text into rows of fields, honouring quotes and CRLF. */
function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function fromDelimited(grid: string[][], format: TableFormat, maxRows: number, maxCols: number): TableData {
  if (grid.length === 0) return { format, columns: [], rows: [], truncatedRows: 0, truncatedCols: 0 }
  const [header, ...body] = grid
  const columns = header.slice(0, maxCols)
  return {
    format,
    columns,
    rows: body.slice(0, maxRows).map((r) => r.slice(0, maxCols)),
    truncatedRows: Math.max(0, body.length - maxRows),
    truncatedCols: Math.max(0, header.length - maxCols),
  }
}

/** Render a JSON value into a flat cell string. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJsonl(text: string, maxRows: number, maxCols: number): TableData {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const values: unknown[] = lines.map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return line
    }
  })

  // Columns = union of object keys, in first-seen order, capped at maxCols.
  const columns: string[] = []
  const seen = new Set<string>()
  let truncatedCols = 0
  for (const v of values) {
    if (isPlainObject(v)) {
      for (const k of Object.keys(v)) {
        if (seen.has(k)) continue
        seen.add(k)
        if (columns.length < maxCols) columns.push(k)
        else truncatedCols++
      }
    }
  }

  // No object rows: show a single column with each line's value.
  if (columns.length === 0) {
    const rows = values.slice(0, maxRows).map((v) => [cell(v)])
    return {
      format: 'jsonl',
      columns: ['value'],
      rows,
      truncatedRows: Math.max(0, values.length - maxRows),
      truncatedCols: 0,
    }
  }

  const rows = values
    .slice(0, maxRows)
    .map((v) => (isPlainObject(v) ? columns.map((c) => cell(v[c])) : columns.map((_c, i) => (i === 0 ? cell(v) : ''))))
  return { format: 'jsonl', columns, rows, truncatedRows: Math.max(0, values.length - maxRows), truncatedCols }
}

/**
 * Parse tabular file text into a grid. Returns null if the name is not a known
 * tabular format. `maxRows` caps the data rows kept (excess counted in
 * truncatedRows).
 */
export function parseTable(name: string, text: string, maxRows = 2000, maxCols = MAX_TABLE_COLS): TableData | null {
  const format = tableFormat(name)
  if (!format) return null
  if (format === 'jsonl') return parseJsonl(text, maxRows, maxCols)
  return fromDelimited(parseDelimited(text, format === 'tsv' ? '\t' : ','), format, maxRows, maxCols)
}
