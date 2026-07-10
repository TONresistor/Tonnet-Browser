import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: class {} }))

import { createTabStorageState, disposeTabStorageState, initStorageListener } from '../tabs-storage'

describe('tab storage state ownership', () => {
  it('isolates proxy discoveries and caches between tab-manager instances', () => {
    const first = createTabStorageState()
    const second = createTabStorageState()
    const proxy = new EventEmitter()
    const registration = initStorageListener(first, proxy)

    proxy.emit('storage-bag-detected', { bagId: 'a'.repeat(64), domain: 'example.ton' })
    first.fileBrowserCache.set(7, '<html>first</html>')

    expect(first.storageBagCache.get('example.ton')).toBe('a'.repeat(64))
    expect(second.storageBagCache.size).toBe(0)
    expect(second.fileBrowserCache.size).toBe(0)

    registration.dispose()
    proxy.emit('storage-bag-detected', { bagId: 'b'.repeat(64), domain: 'other.ton' })
    expect(first.storageBagCache.has('other.ton')).toBe(false)
  })

  it('drops every owned reference during disposal', () => {
    const state = createTabStorageState()
    state.storageManager = {} as never
    state.storageBagCache.set('example.ton', 'a'.repeat(64))
    state.storageBrowserLoading.add(7)
    state.fileBrowserCache.set(7, '<html></html>')

    disposeTabStorageState(state)

    expect(state.storageManager).toBeNull()
    expect(state.storageBagCache.size).toBe(0)
    expect(state.storageBrowserLoading.size).toBe(0)
    expect(state.fileBrowserCache.size).toBe(0)
  })
})
