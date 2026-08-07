import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {} }))

import { getMainWindow, setMainWindow } from '../main'

describe('main window reference', () => {
  it('ignores a stale closed event from a replaced window', () => {
    const first = new EventEmitter()
    const second = new EventEmitter()

    setMainWindow(first as never)
    setMainWindow(second as never)
    first.emit('closed')

    expect(getMainWindow()).toBe(second)

    second.emit('closed')
    expect(getMainWindow()).toBeNull()
  })
})
