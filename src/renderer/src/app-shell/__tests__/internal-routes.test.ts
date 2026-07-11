import { describe, expect, it, vi } from 'vitest'
import { getInternalPageFavicon, getInternalPageTitle, isInternalUrl, resolveInternalRoute } from '../internal-routes'

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) =>
      ({
        'tabs.newTab': 'New Tab',
        'storage.title': 'TON Storage',
        'page.title': 'Wallet',
        title: 'Settings',
        appName: 'TON Browser',
      })[key] ?? key,
  },
}))

describe('internal route registry', () => {
  it('distinguishes internal and external URLs', () => {
    expect(isInternalUrl('ton://wallet')).toBe(true)
    expect(resolveInternalRoute('https://example.com')).toBeNull()
  })

  it('resolves static routes from the canonical registry', () => {
    expect(resolveInternalRoute('ton://wallet')).toEqual({ kind: 'wallet', view: 'wallet' })
    expect(getInternalPageTitle('ton://wallet')).toBe('Wallet')
    expect(getInternalPageFavicon('ton://wallet')).toBeTruthy()
  })

  it('parses storage browse and viewer parameters', () => {
    expect(resolveInternalRoute('ton://storage/browse/bag-id')).toEqual({
      kind: 'storage-browse',
      view: 'storage-browse',
      bagId: 'bag-id',
    })
    expect(resolveInternalRoute('ton://storage/view/bag-id/path%20to%2Ffile.csv')).toEqual({
      kind: 'storage-view',
      view: 'storage-view',
      bagId: 'bag-id',
      filePath: 'path to/file.csv',
    })
    expect(getInternalPageTitle('ton://storage/view/bag-id/file.csv')).toBe('TON Storage')
  })

  it('preserves malformed encoded viewer paths instead of throwing', () => {
    expect(resolveInternalRoute('ton://storage/view/bag-id/%ZZ')).toEqual({
      kind: 'storage-view',
      view: 'storage-view',
      bagId: 'bag-id',
      filePath: '%ZZ',
    })
  })

  it('uses the stable fallback for unknown and malformed internal routes', () => {
    expect(resolveInternalRoute('ton://unknown')).toEqual({ kind: 'fallback', view: 'start' })
    expect(resolveInternalRoute('ton://storage/view/missing-file')).toEqual({ kind: 'fallback', view: 'start' })
    expect(getInternalPageTitle('ton://unknown')).toBe('TON Browser')
    expect(getInternalPageFavicon('ton://unknown')).toBeNull()
  })
})
