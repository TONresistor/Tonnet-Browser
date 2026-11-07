import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'
import type { ServiceRegistry } from '../services'
import { runBookmarksScenario, waitForBookmarkedPage } from '../bookmarks-runtime-tests'
import {
  assertLivePage,
  assertPackageOverlayClosed,
  assertStorageTable,
  focusPackageInput,
  packageTestStep,
  waitForPackageCheck,
  type LivePageSnapshot,
} from '../packaged-page-assertions'

describe('bounded package checks', () => {
  it('waits for both window and contents focus before native input can continue', async () => {
    vi.useFakeTimers()
    try {
      let windowFocused = false
      let contentsFocused = false
      const window = {
        isVisible: () => true,
        focus: vi.fn(),
        isFocused: () => windowFocused,
      } as unknown as BrowserWindow
      const contents = { focus: vi.fn(), isFocused: () => contentsFocused } as unknown as WebContents
      let continued = false
      const focused = focusPackageInput(window, contents).then(() => {
        continued = true
      })
      windowFocused = true
      await vi.advanceTimersByTimeAsync(50)
      expect(continued).toBe(false)
      contentsFocused = true
      await vi.advanceTimersByTimeAsync(50)
      await focused
      expect(window.focus).toHaveBeenCalledOnce()
      expect(contents.focus).toHaveBeenCalledOnce()
      expect(continued).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects native input when the visible window never gains focus', async () => {
    vi.useFakeTimers()
    try {
      const window = { isVisible: () => true, focus: vi.fn(), isFocused: () => false } as unknown as BrowserWindow
      const contents = { focus: vi.fn(), isFocused: () => true } as unknown as WebContents
      const result = expect(focusPackageInput(window, contents)).rejects.toThrow(
        'Native package input did not receive focus'
      )
      await vi.advanceTimersByTimeAsync(30_000)
      await result
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses native input in an invisible window', async () => {
    const window = { isVisible: () => false, focus: vi.fn() } as unknown as BrowserWindow
    const contents = { focus: vi.fn() } as unknown as WebContents
    await expect(focusPackageInput(window, contents)).rejects.toThrow('requires a visible window')
    expect(window.focus).not.toHaveBeenCalled()
    expect(contents.focus).not.toHaveBeenCalled()
  })
  it.each(['resolve', 'reject'] as const)(
    'does not resume polling after a timed-out check later %ss',
    async (outcome) => {
      vi.useFakeTimers()
      try {
        let resolve!: (value: boolean) => void
        let reject!: (error: Error) => void
        const check = vi.fn(
          () =>
            new Promise<boolean>((ok, fail) => {
              resolve = ok
              reject = fail
            })
        )
        const result = expect(waitForPackageCheck(check, 'stuck renderer', 100)).rejects.toThrow('stuck renderer')
        await vi.advanceTimersByTimeAsync(100)
        await result
        if (outcome === 'resolve') resolve(false)
        else reject(new Error('late renderer error'))
        await vi.advanceTimersByTimeAsync(1000)
        expect(check).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('uses one deadline across repeated checks and retains the latest diagnostic', async () => {
    vi.useFakeTimers()
    try {
      let attempts = 0
      const result = expect(
        waitForPackageCheck(
          () => {
            attempts++
            return false
          },
          () => `attempts: ${attempts}`,
          100
        )
      ).rejects.toThrow('attempts: 2')
      await vi.advanceTimersByTimeAsync(100)
      await result
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears step timers on success and preserves genuine errors', async () => {
    vi.useFakeTimers()
    try {
      await expect(packageTestStep(() => 42, 'timeout')).resolves.toBe(42)
      const error = new Error('broken assertion')
      await expect(
        packageTestStep(() => {
          throw error
        }, 'timeout')
      ).rejects.toBe(error)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([true, false])('requires the cancelled overlay to detach (detaches: %s)', async (detaches) => {
    vi.useFakeTimers()
    try {
      const contents = {} as WebContents
      const children = [{ webContents: contents }]
      const window = { contentView: { children } } as unknown as BrowserWindow
      let continued = false
      const check = assertPackageOverlayClosed(window, contents, 'Cancelled toolbar edit').then(() => {
        continued = true
      })
      if (detaches) {
        await vi.advanceTimersByTimeAsync(100)
        expect(continued).toBe(false)
        children.pop()
        await vi.advanceTimersByTimeAsync(50)
        await check
        expect(continued).toBe(true)
      } else {
        const result = expect(check).rejects.toThrow('Cancelled toolbar edit: overlay did not close')
        await vi.advanceTimersByTimeAsync(30_000)
        await result
        expect(continued).toBe(false)
      }
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

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
  it('waits for the target view without querying the old view during a domain change', async () => {
    vi.useFakeTimers()
    try {
      const old = {
        webContents: {
          id: 1,
          isDestroyed: () => false,
          isLoading: () => false,
          getURL: () => manifesto.url,
          executeJavaScript: vi.fn(() => new Promise(() => {})),
        },
      }
      const target = {
        webContents: {
          id: 2,
          isDestroyed: () => false,
          isLoading: () => false,
          getURL: () => add.url,
          executeJavaScript: vi.fn(async () => add),
        },
      }
      let active: unknown = old
      const children: unknown[] = [old]
      const window = { contentView: { children } } as unknown as BrowserWindow
      const services = { tabManager: { getActiveView: () => active } } as unknown as ServiceRegistry
      const result = waitForBookmarkedPage(window, services, add.url)
      await vi.advanceTimersByTimeAsync(10)
      active = target
      children.splice(0, 1, target)
      await vi.advanceTimersByTimeAsync(50)
      await result
      expect(old.webContents.executeJavaScript).not.toHaveBeenCalled()
      expect(target.webContents.executeJavaScript).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a valid late snapshot from a replaced view even when the replacement has the same URL', async () => {
    vi.useFakeTimers()
    try {
      let resolve!: (page: LivePageSnapshot) => void
      const old = {
        webContents: {
          id: 1,
          isDestroyed: () => false,
          isLoading: () => false,
          getURL: () => add.url,
          executeJavaScript: vi.fn(
            () =>
              new Promise<LivePageSnapshot>((ok) => {
                resolve = ok
              })
          ),
        },
      }
      const target = {
        webContents: {
          id: 2,
          isDestroyed: () => false,
          isLoading: () => false,
          getURL: () => add.url,
          executeJavaScript: vi.fn(async () => ({ ...add, headings: ['Unavailable'] })),
        },
      }
      let active: unknown = old
      const children: unknown[] = [old]
      const window = { contentView: { children } } as unknown as BrowserWindow
      const services = { tabManager: { getActiveView: () => active } } as unknown as ServiceRegistry
      const result = expect(waitForBookmarkedPage(window, services, add.url)).rejects.toThrow(
        'Add a Bag heading missing'
      )
      await vi.advanceTimersByTimeAsync(10)
      active = target
      children.splice(0, 1, target)
      resolve(add)
      await vi.advanceTimersByTimeAsync(121_000)
      await result
      expect(target.webContents.executeJavaScript).toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the native URL and view state when the target never becomes active', async () => {
    vi.useFakeTimers()
    try {
      const view = {
        webContents: {
          id: 7,
          isDestroyed: () => false,
          isLoading: () => false,
          getURL: () => manifesto.url,
          executeJavaScript: vi.fn(),
        },
      }
      const window = { contentView: { children: [view] } } as unknown as BrowserWindow
      const services = { tabManager: { getActiveView: () => view } } as unknown as ServiceRegistry
      const result = expect(waitForBookmarkedPage(window, services, add.url)).rejects.toThrow(
        `view=7; url=${manifesto.url}; loading=false; attached=true`
      )
      await vi.advanceTimersByTimeAsync(121_000)
      await result
      expect(view.webContents.executeJavaScript).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the last page assertion when bookmarked content never becomes valid', async () => {
    vi.useFakeTimers()
    try {
      const view = {
        webContents: {
          id: 1,
          isDestroyed: () => false,
          getURL: () => add.url,
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
