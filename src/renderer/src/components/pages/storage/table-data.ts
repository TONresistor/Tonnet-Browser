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
}

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

function fromDelimited(grid: string[][], format: TableFormat, maxRows: number): TableData {
  if (grid.length === 0) return { format, columns: [], rows: [], truncatedRows: 0 }
  const [columns, ...body] = grid
  return {
    format,
    columns,
    rows: body.slice(0, maxRows),
    truncatedRows: Math.max(0, body.length - maxRows),
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

function parseJsonl(text: string, maxRows: number): TableData {
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

  // Columns = union of object keys, in first-seen order.
  const columns: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    if (isPlainObject(v)) {
      for (const k of Object.keys(v)) {
        if (!seen.has(k)) {
          seen.add(k)
          columns.push(k)
        }
      }
    }
  }

  // No object rows: show a single column with each line's value.
  if (columns.length === 0) {
    const rows = values.slice(0, maxRows).map((v) => [cell(v)])
    return { format: 'jsonl', columns: ['value'], rows, truncatedRows: Math.max(0, values.length - maxRows) }
  }

  const rows = values
    .slice(0, maxRows)
    .map((v) => (isPlainObject(v) ? columns.map((c) => cell(v[c])) : columns.map((_c, i) => (i === 0 ? cell(v) : ''))))
  return { format: 'jsonl', columns, rows, truncatedRows: Math.max(0, values.length - maxRows) }
}

/**
 * Parse tabular file text into a grid. Returns null if the name is not a known
 * tabular format. `maxRows` caps the data rows kept (excess counted in
 * truncatedRows).
 */
export function parseTable(name: string, text: string, maxRows = 2000): TableData | null {
  const format = tableFormat(name)
  if (!format) return null
  if (format === 'jsonl') return parseJsonl(text, maxRows)
  return fromDelimited(parseDelimited(text, format === 'tsv' ? '\t' : ','), format, maxRows)
}
