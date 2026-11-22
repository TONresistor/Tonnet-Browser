import { describe, expect, it } from 'vitest'
import { selectTabTraversal, tabNavigationFlags } from '../tab-history'

describe('native and internal navigation boundaries', () => {
  it('returns through native history before resuming the internal forward entry', () => {
    const tab = {
      url: 'http://site.ton/b',
      history: ['http://site.ton/b', 'ton://settings'],
      historyIndex: 0,
      nativeCanGoBack: true,
      nativeCanGoForward: false,
    }
    expect(selectTabTraversal(tab, 'forward')).toBe(1)
    expect(selectTabTraversal(tab, 'back')).toBe('native')
    const previousNativePage = { ...tab, url: 'http://site.ton/a', nativeCanGoBack: false, nativeCanGoForward: true }
    expect(selectTabTraversal(previousNativePage, 'forward')).toBe('native')
    expect(selectTabTraversal({ ...previousNativePage, url: tab.url }, 'forward')).toBe(1)
    expect(tabNavigationFlags({ ...tab, url: 'ton://settings', historyIndex: 1 })).toEqual({
      canGoBack: true,
      canGoForward: false,
    })
  })

  it('never traverses native data/file entries in a legacy Storage segment', () => {
    const listing = {
      url: 'http://bag.ton',
      history: ['http://bag.ton', 'file:///storage/bag/file.pdf'],
      historyIndex: 0,
      legacyStorageHistory: true,
      nativeCanGoBack: true,
      nativeCanGoForward: true,
    }
    expect(tabNavigationFlags(listing)).toEqual({ canGoBack: false, canGoForward: true })
    expect(selectTabTraversal(listing, 'back')).toBeNull()
    expect(selectTabTraversal(listing, 'forward')).toBe(1)
    expect(selectTabTraversal({ ...listing, url: listing.history[1], historyIndex: 1 }, 'back')).toBe(0)
  })

  it('walks the app-level list when a new domain discarded Chromium history', () => {
    const afterDomainChange = {
      url: 'http://b.com/',
      history: ['http://a.com/', 'http://b.com/'],
      historyIndex: 1,
      nativeCanGoBack: false,
      nativeCanGoForward: false,
    }
    expect(selectTabTraversal(afterDomainChange, 'back')).toBe(0)
    expect(tabNavigationFlags(afterDomainChange)).toEqual({ canGoBack: true, canGoForward: false })
    expect(selectTabTraversal({ ...afterDomainChange, historyIndex: 0, url: 'http://a.com/' }, 'forward')).toBe(1)
  })

  it('goes forward to the other domain after a back across domains', () => {
    // A -> B -> Back to A. Chromium recreated the view for A, and it still
    // reports a forward entry it cannot reach: B lives in the other view.
    const afterBack = {
      url: 'http://a.com/',
      history: ['http://a.com/', 'http://b.com/'],
      historyIndex: 0,
      nativeCanGoBack: false,
      nativeCanGoForward: true,
    }
    expect(selectTabTraversal(afterBack, 'forward')).toBe(1)
    expect(tabNavigationFlags(afterBack)).toEqual({ canGoBack: false, canGoForward: true })
  })

  it('prefers the page behind it over an internal route further back', () => {
    const afterBlockedLink = {
      url: 'http://me/krasovsky',
      history: ['ton://start', 'http://krasovsky.ton/', 'http://me/krasovsky'],
      historyIndex: 2,
      nativeCanGoBack: false,
      nativeCanGoForward: false,
    }
    expect(selectTabTraversal(afterBlockedLink, 'back')).toBe(1)
    expect(selectTabTraversal({ ...afterBlockedLink, url: 'http://krasovsky.ton/', historyIndex: 1 }, 'back')).toBe(0)
  })

  it('still prefers Chromium history and never re-offers the page on screen', () => {
    const liveChromium = {
      url: 'http://site.ton/b',
      history: ['http://site.ton/a', 'http://site.ton/b'],
      historyIndex: 1,
      nativeCanGoBack: true,
    }
    expect(selectTabTraversal(liveChromium, 'back')).toBe('native')
    const duplicate = {
      url: 'http://site.ton/a',
      history: ['http://site.ton/a', 'http://site.ton/a'],
      historyIndex: 1,
      nativeCanGoBack: false,
    }
    expect(selectTabTraversal(duplicate, 'back')).toBeNull()
  })
})
