import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/window-bounds-v0.json'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileAtomic: vi.fn(async () => {}),
  writeSecureJsonAtomic: vi.fn(),
  windows: [] as Array<{
    getBounds(): { x: number; y: number; width: number; height: number }
    isMaximized(): boolean
  }>,
}))

vi.mock('fs', () => ({ existsSync: mocks.existsSync, readFileSync: mocks.readFileSync }))
vi.mock('../../utils/secure-fs', () => ({
  writeFileAtomic: mocks.writeFileAtomic,
  writeSecureJsonAtomic: mocks.writeSecureJsonAtomic,
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/user-data' },
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  BrowserWindow: { getAllWindows: () => mocks.windows },
}))

vi.mock('../../../shared/logger', () => ({
  default: { scope: () => ({ error: vi.fn() }), error: vi.fn() },
}))

import { flushWindowBoundsOnQuit, loadWindowBounds, saveWindowBounds } from '../bounds'

const window = {
  getBounds: () => fixture,
  isMaximized: () => true,
}

describe('window bounds persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify(fixture))
    mocks.windows.splice(0)
  })

  afterEach(() => vi.useRealTimers())

  it('loads the frozen unversioned v0 fixture', () => {
    expect(loadWindowBounds()).toEqual(fixture)
  })

  it('loads the current versioned document', () => {
    mocks.readFileSync.mockReturnValue(JSON.stringify({ schemaVersion: 1, bounds: fixture }))
    expect(loadWindowBounds()).toEqual(fixture)
  })

  it('persists debounced updates atomically in the v1 envelope', async () => {
    saveWindowBounds(window as never)
    await vi.runAllTimersAsync()

    expect(mocks.writeFileAtomic).toHaveBeenCalledOnce()
    const calls = mocks.writeFileAtomic.mock.calls as unknown as Array<[string, string]>
    const document = JSON.parse(calls[0][1])
    expect(document).toEqual({ schemaVersion: 1, bounds: { ...fixture, isMaximized: true } })
  })

  it('flushes a pending update synchronously in the same v1 envelope', () => {
    mocks.windows.push(window)
    saveWindowBounds(window as never)
    flushWindowBoundsOnQuit()

    expect(mocks.writeSecureJsonAtomic).toHaveBeenCalledWith('/user-data/window-bounds.json', {
      schemaVersion: 1,
      bounds: { ...fixture, isMaximized: true },
    })
  })
})
