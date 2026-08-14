import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectElementAt, isBlockedChromeShortcut, isDevToolsShortcut, toggleDevTools } from '../devtools'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/** An unmodified press of the physical I key, before per-test overrides. */
function keyDown(overrides: Partial<Electron.Input>): Electron.Input {
  return {
    type: 'keyDown',
    key: 'i',
    code: 'KeyI',
    control: false,
    shift: false,
    alt: false,
    meta: false,
    ...overrides,
  } as Electron.Input
}

function stubContents(devToolsOpen = false) {
  return Object.assign(new EventEmitter(), {
    isDevToolsOpened: vi.fn(() => devToolsOpen),
    openDevTools: vi.fn(),
    closeDevTools: vi.fn(),
    inspectElement: vi.fn(),
  })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
})

describe('DevTools shortcut matching', () => {
  it('matches F12', () => {
    expect(isDevToolsShortcut(keyDown({ key: 'F12', code: 'F12' }))).toBe(true)
  })

  it('matches Ctrl+Shift+I everywhere and Cmd+Option+I only on macOS', () => {
    setPlatform('darwin')
    expect(isDevToolsShortcut(keyDown({ control: true, shift: true }))).toBe(true)
    expect(isDevToolsShortcut(keyDown({ meta: true, alt: true }))).toBe(true)

    setPlatform('win32')
    expect(isDevToolsShortcut(keyDown({ control: true, shift: true }))).toBe(true)
    expect(isDevToolsShortcut(keyDown({ meta: true, alt: true }))).toBe(false)
  })

  it('matches on the physical key, not the layout-dependent character', () => {
    setPlatform('darwin')
    // Cyrillic layout reports 'ш'; Option+I on a macOS US layout reports a dead 'ˆ'.
    expect(isDevToolsShortcut(keyDown({ key: 'ш', control: true, shift: true }))).toBe(true)
    expect(isDevToolsShortcut(keyDown({ key: 'ˆ', meta: true, alt: true }))).toBe(true)
  })

  it('ignores keyUp so the release does not close what the press opened', () => {
    setPlatform('darwin')
    expect(isDevToolsShortcut(keyDown({ type: 'keyUp', meta: true, alt: true }))).toBe(false)
    expect(isDevToolsShortcut(keyDown({ type: 'keyUp', key: 'F12', code: 'F12' }))).toBe(false)
  })

  it('ignores plain typing of the letter i', () => {
    expect(isDevToolsShortcut(keyDown({}))).toBe(false)
    expect(isDevToolsShortcut(keyDown({ shift: true }))).toBe(false)
  })
})

describe('opening DevTools', () => {
  it('toggles detached, never docked under the WebContentsView', () => {
    const closed = stubContents()
    toggleDevTools(closed as never)
    expect(closed.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })

    const open = stubContents(true)
    toggleDevTools(open as never)
    expect(open.closeDevTools).toHaveBeenCalled()
    expect(open.openDevTools).not.toHaveBeenCalled()
  })

  it('inspects an element straight away when DevTools are already open', () => {
    const contents = stubContents(true)

    inspectElementAt(contents as never, 12, 34)

    expect(contents.inspectElement).toHaveBeenCalledWith(12, 34)
    expect(contents.openDevTools).not.toHaveBeenCalled()
  })

  it('waits for DevTools to open before inspecting an element', () => {
    const contents = stubContents()

    inspectElementAt(contents as never, 12, 34)

    expect(contents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
    expect(contents.inspectElement).not.toHaveBeenCalled()

    contents.emit('devtools-opened')
    expect(contents.inspectElement).toHaveBeenCalledWith(12, 34)
  })
})

describe('Chrome shortcut guards (replacing optimizer.watchWindowShortcuts)', () => {
  it('never claims the DevTools shortcut, so the two handlers cannot cancel out', () => {
    // The regression this guards: the toolkit toggled the window's DevTools on
    // F12 in dev while the window handler toggled the same webContents on a
    // system page, so F12 opened and closed them in one press and appeared dead.
    for (const isDev of [true, false]) {
      expect(isBlockedChromeShortcut(keyDown({ key: 'F12', code: 'F12' }), isDev)).toBe(false)
      expect(isBlockedChromeShortcut(keyDown({ control: true, shift: true }), isDev)).toBe(false)
      expect(isBlockedChromeShortcut(keyDown({ meta: true, alt: true }), isDev)).toBe(false)
    }
  })

  it('blocks chrome reload in production but leaves it for dev HMR recovery', () => {
    const reload = keyDown({ key: 'r', code: 'KeyR', control: true })
    expect(isBlockedChromeShortcut(reload, false)).toBe(true)
    expect(isBlockedChromeShortcut(reload, true)).toBe(false)
    expect(isBlockedChromeShortcut(keyDown({ key: 'r', code: 'KeyR', meta: true }), false)).toBe(true)
  })

  it('blocks chrome zoom on both platforms and in both modes', () => {
    for (const isDev of [true, false]) {
      expect(isBlockedChromeShortcut(keyDown({ key: '-', code: 'Minus', control: true }), isDev)).toBe(true)
      expect(isBlockedChromeShortcut(keyDown({ key: '-', code: 'Minus', meta: true }), isDev)).toBe(true)
      expect(isBlockedChromeShortcut(keyDown({ key: '+', code: 'Equal', control: true, shift: true }), isDev)).toBe(
        true
      )
    }
  })

  it('ignores unmodified keys, plain Equal, and keyUp', () => {
    expect(isBlockedChromeShortcut(keyDown({ key: 'r', code: 'KeyR' }), false)).toBe(false)
    expect(isBlockedChromeShortcut(keyDown({ key: '-', code: 'Minus' }), false)).toBe(false)
    expect(isBlockedChromeShortcut(keyDown({ key: '=', code: 'Equal', control: true }), false)).toBe(false)
    expect(
      isBlockedChromeShortcut({ ...keyDown({ key: 'r', code: 'KeyR', control: true }), type: 'keyUp' }, false)
    ).toBe(false)
  })
})
