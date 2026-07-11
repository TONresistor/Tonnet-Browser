import { describe, expect, it } from 'vitest'
import { bookmarksLoadContract, bookmarksSaveContract, BookmarksDataSchema } from '../bookmarks'

const validData = {
  bookmarks: [
    {
      id: 'bookmark-1',
      url: 'http://manifesto.ton',
      title: 'Manifesto',
      folderId: null,
      createdAt: 1,
      order: 0,
    },
  ],
  folders: [],
}

describe('bookmarks IPC contract', () => {
  it('declares stable channels and the main-renderer caller', () => {
    expect(bookmarksLoadContract).toMatchObject({
      channel: 'bookmarks:load',
      direction: 'request',
      caller: 'main-renderer',
      authorization: 'main-window',
      rateLimit: { kind: 'none' },
    })
    expect(bookmarksSaveContract).toMatchObject({
      channel: 'bookmarks:save',
      direction: 'request',
      caller: 'main-renderer',
      authorization: 'main-window',
      rateLimit: { kind: 'none' },
    })
  })

  it('accepts the persisted bookmark shape', () => {
    expect(BookmarksDataSchema.parse(validData)).toEqual(validData)
    expect(bookmarksSaveContract.input.parse([validData])).toEqual([validData])
  })

  it('rejects malformed and oversized boundary data', () => {
    expect(() => bookmarksSaveContract.input.parse([{ bookmarks: [{}], folders: [] }])).toThrow()
    expect(() =>
      BookmarksDataSchema.parse({ bookmarks: [], folders: Array.from({ length: 10_001 }, () => ({})) })
    ).toThrow()
  })
})
