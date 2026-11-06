import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ServiceRegistry } from '../services'
import { runBookmarksScenario } from '../bookmarks-runtime-tests'
import { assertLivePage, assertStorageTable, type LivePageSnapshot } from '../packaged-page-assertions'

const manifesto: LivePageSnapshot = {
  url: 'http://manifesto.ton/',
  title: 'Digital Resistance Manifesto',
  text: 'Resistance '.repeat(30),
  headings: ['Digital Resistance Manifesto'],
  formCount: 0,
  links: [],
}
const add: LivePageSnapshot = {
  url: 'http://piracy.ton/add.html',
  title: 'Add a Bag',
  text: 'Add a Bag',
  headings: ['Add a Bag'],
  formCount: 1,
  links: [],
}

describe('packaged content oracles', () => {
  it('reports the last page assertion when bookmarked content never becomes valid', async () => {
    vi.useFakeTimers()
    try {
      const view = {
        webContents: {
          isLoading: () => false,
          executeJavaScript: async () => ({ ...add, headings: ['Unavailable'] }),
        },
      }
      const window = {
        contentView: { children: [view] },
        webContents: { executeJavaScript: async () => true },
      } as unknown as BrowserWindow
      const services = { tabManager: { getActiveView: () => view } } as unknown as ServiceRegistry
      const result = expect(
        runBookmarksScenario({ window, services, profile: '', phase: 'smoke', pass: vi.fn() })
      ).rejects.toThrow('last failure: Add a Bag heading missing')
      await vi.advanceTimersByTimeAsync(121_000)
      await result
    } finally {
      vi.useRealTimers()
    }
  })
  it('accepts the intended sites and rejects a nonempty error page at the right URL', () => {
    expect(() => assertLivePage(manifesto, manifesto.url)).not.toThrow()
    expect(() =>
      assertLivePage(
        { ...manifesto, title: 'Gateway error', headings: ['Error'], text: 'Manifesto unavailable '.repeat(20) },
        manifesto.url
      )
    ).toThrow('identity')
    expect(() => assertLivePage({ ...manifesto, url: 'http://other.ton/' }, manifesto.url)).toThrow('URL')
  })
  it('requires the actual internal link on the Piracy homepage', () => {
    const page = {
      ...manifesto,
      url: 'http://piracy.ton/',
      title: 'Piracy',
      headings: ['Piracy'],
      links: ['http://piracy.ton/add.html'],
    }
    expect(() => assertLivePage(page, page.url)).not.toThrow()
    expect(() => assertLivePage({ ...page, links: [] }, page.url)).toThrow('link')
  })
  it('rejects Add Bag when either its heading or its form is broken', () => {
    expect(() => assertLivePage(add, add.url)).not.toThrow()
    expect(() => assertLivePage({ ...add, formCount: 0 }, add.url)).toThrow('form')
    expect(() => assertLivePage({ ...add, headings: ['Unavailable'] }, add.url)).toThrow('heading')
  })
  it('does not accept the CSV marker when its value, shape or columns are wrong', () => {
    expect(() => assertStorageTable({ columns: ['name', 'value'], rows: [['smoke-route', '42']] })).not.toThrow()
    expect(() => assertStorageTable({ columns: ['name', 'value'], rows: [['smoke-route', '0']] })).toThrow()
    expect(() =>
      assertStorageTable({
        columns: ['name', 'value'],
        rows: [
          ['smoke-route', '42'],
          ['extra', '42'],
        ],
      })
    ).toThrow()
    expect(() => assertStorageTable({ columns: ['value', 'name'], rows: [['smoke-route', '42']] })).toThrow()
  })
})
