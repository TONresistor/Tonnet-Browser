import { describe, it, expect } from 'vitest'
import { isTabularFile, tableFormat, parseTable, MAX_TABLE_COLS } from '../table-data'

describe('tableFormat / isTabularFile', () => {
  it('recognises tabular extensions', () => {
    expect(tableFormat('a.csv')).toBe('csv')
    expect(tableFormat('a.TSV')).toBe('tsv')
    expect(tableFormat('a.jsonl')).toBe('jsonl')
    expect(tableFormat('a.ndjson')).toBe('jsonl')
    expect(isTabularFile('data.csv')).toBe(true)
    expect(isTabularFile('song.mp3')).toBe(false)
    expect(isTabularFile('noext')).toBe(false)
  })

  it('returns null for non-tabular files', () => {
    expect(parseTable('a.txt', 'x')).toBeNull()
  })
})

describe('parseTable csv', () => {
  it('splits header and rows', () => {
    const t = parseTable('d.csv', 'a,b,c\n1,2,3\n4,5,6')!
    expect(t.columns).toEqual(['a', 'b', 'c'])
    expect(t.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('honours quotes, embedded commas, escaped quotes and newlines', () => {
    const t = parseTable('d.csv', 'name,note\n"Doe, John","say ""hi""\nok"')!
    expect(t.columns).toEqual(['name', 'note'])
    expect(t.rows).toEqual([['Doe, John', 'say "hi"\nok']])
  })

  it('ignores a trailing newline', () => {
    const t = parseTable('d.csv', 'a\n1\n')!
    expect(t.rows).toEqual([['1']])
  })

  it('parses tsv with tab delimiter', () => {
    const t = parseTable('d.tsv', 'a\tb\n1\t2')!
    expect(t.rows).toEqual([['1', '2']])
  })

  it('caps rows and reports the count dropped', () => {
    const t = parseTable('d.csv', 'a\n1\n2\n3', 1)!
    expect(t.rows).toEqual([['1']])
    expect(t.truncatedRows).toBe(2)
  })

  it('handles empty input', () => {
    const t = parseTable('d.csv', '')!
    expect(t.columns).toEqual([])
    expect(t.rows).toEqual([])
  })
})

describe('parseTable jsonl', () => {
  it('unions object keys and fills missing cells', () => {
    const t = parseTable('d.jsonl', '{"a":1,"b":2}\n{"a":3,"c":4}')!
    expect(t.columns).toEqual(['a', 'b', 'c'])
    expect(t.rows).toEqual([
      ['1', '2', ''],
      ['3', '', '4'],
    ])
  })

  it('stringifies nested values', () => {
    const t = parseTable('d.jsonl', '{"x":{"y":1},"z":[1,2]}')!
    expect(t.rows).toEqual([['{"y":1}', '[1,2]']])
  })

  it('falls back to a value column for non-object lines', () => {
    const t = parseTable('d.jsonl', '1\n"hi"\nnot json')!
    expect(t.columns).toEqual(['value'])
    expect(t.rows).toEqual([['1'], ['hi'], ['not json']])
  })

  it('skips blank lines', () => {
    const t = parseTable('d.jsonl', '{"a":1}\n\n{"a":2}\n')!
    expect(t.rows).toEqual([['1'], ['2']])
  })

  it('caps JSONL columns at MAX_TABLE_COLS and reports the overflow', () => {
    const wide = JSON.stringify(Object.fromEntries(Array.from({ length: MAX_TABLE_COLS + 25 }, (_, i) => [`k${i}`, i])))
    const t = parseTable('wide.jsonl', wide)!
    expect(t.columns).toHaveLength(MAX_TABLE_COLS)
    expect(t.truncatedCols).toBe(25)
    expect(t.rows[0]).toHaveLength(MAX_TABLE_COLS)
  })

  it('caps CSV columns and truncates each row to the cap', () => {
    const header = Array.from({ length: MAX_TABLE_COLS + 5 }, (_, i) => `c${i}`).join(',')
    const rowValues = Array.from({ length: MAX_TABLE_COLS + 5 }, (_, i) => String(i)).join(',')
    const t = parseTable('wide.csv', `${header}\n${rowValues}`)!
    expect(t.columns).toHaveLength(MAX_TABLE_COLS)
    expect(t.truncatedCols).toBe(5)
    expect(t.rows[0]).toHaveLength(MAX_TABLE_COLS)
  })

  it('caps rows and reports truncatedRows', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `{"a":${i}}`).join('\n')
    const t = parseTable('r.jsonl', lines, 4)!
    expect(t.rows).toHaveLength(4)
    expect(t.truncatedRows).toBe(6)
  })
})
