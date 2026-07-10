import { describe, expect, it } from 'vitest'
import { historyGetByDateContract, historySearchContract, HistoryEntrySchema } from '../history'

describe('history IPC contracts', () => {
  it('bounds searches and result entries', () => {
    expect(historySearchContract.input.parse(['ton', 20])).toEqual(['ton', 20])
    expect(() => historySearchContract.input.parse(['ton', 1001])).toThrow()
    expect(() => HistoryEntrySchema.parse({ id: 'x' })).toThrow()
  })
  it('rejects reversed or invalid date ranges', () => {
    expect(historyGetByDateContract.input.parse([1, 2])).toEqual([1, 2])
    expect(() => historyGetByDateContract.input.parse([2, 1])).toThrow()
    expect(() => historyGetByDateContract.input.parse([-1, 2])).toThrow()
  })
})
