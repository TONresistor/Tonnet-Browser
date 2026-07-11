import { describe, expect, it } from 'vitest'
import { sidebarWidthContract } from '../window'

describe('window IPC contracts', () => {
  it('accepts bounded finite widths only', () => {
    expect(sidebarWidthContract.input.parse([320])).toEqual([320])
    for (const width of [-1, 3001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sidebarWidthContract.input.parse([width])).toThrow()
    }
  })
})
