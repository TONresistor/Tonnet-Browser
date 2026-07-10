import { EventEmitter } from 'events'
import { DisposableStore, onWebContents, onEmitter, IDisposable } from '../disposable'

vi.mock('../../../shared/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}))

describe('DisposableStore', () => {
  it('disposes all added items', () => {
    const store = new DisposableStore()
    const d1 = { dispose: vi.fn() }
    const d2 = { dispose: vi.fn() }
    store.add(d1)
    store.add(d2)

    store.dispose()

    expect(d1.dispose).toHaveBeenCalledOnce()
    expect(d2.dispose).toHaveBeenCalledOnce()
  })

  it('continues disposing after one cleanup throws', () => {
    const store = new DisposableStore()
    const final = { dispose: vi.fn() }
    store.add({
      dispose: () => {
        throw new Error('cleanup failed')
      },
    })
    store.add(final)

    expect(() => store.dispose()).not.toThrow()
    expect(final.dispose).toHaveBeenCalledOnce()
  })

  it('returns the added item for chaining', () => {
    const store = new DisposableStore()
    const d: IDisposable = { dispose: vi.fn() }
    expect(store.add(d)).toBe(d)
  })

  it('double dispose is idempotent', () => {
    const store = new DisposableStore()
    const d = { dispose: vi.fn() }
    store.add(d)

    store.dispose()
    store.dispose()

    expect(d.dispose).toHaveBeenCalledOnce()
  })

  it('add() after dispose() immediately disposes the item', () => {
    const store = new DisposableStore()
    store.dispose()

    const d = { dispose: vi.fn() }
    store.add(d)

    expect(d.dispose).toHaveBeenCalledOnce()
  })

  it('isDisposed returns correct state', () => {
    const store = new DisposableStore()
    expect(store.isDisposed).toBe(false)

    store.dispose()
    expect(store.isDisposed).toBe(true)
  })
})

describe('onWebContents', () => {
  function mockWebContents(destroyed = false) {
    return {
      on: vi.fn(),
      removeListener: vi.fn(),
      isDestroyed: () => destroyed,
    } as unknown as Electron.WebContents
  }

  it('attaches listener and removes on dispose', () => {
    const wc = mockWebContents()
    const handler = vi.fn()

    const d = onWebContents(wc, 'did-navigate', handler)

    expect(wc.on).toHaveBeenCalledWith('did-navigate', handler)

    d.dispose()

    expect(wc.removeListener).toHaveBeenCalledWith('did-navigate', handler)
  })

  it('skips removal if webContents is destroyed', () => {
    const wc = mockWebContents(true)
    const handler = vi.fn()

    const d = onWebContents(wc, 'did-navigate', handler)
    d.dispose()

    expect(wc.removeListener).not.toHaveBeenCalled()
  })
})

describe('onEmitter', () => {
  it('attaches listener and removes on dispose', () => {
    const emitter = new EventEmitter()
    const handler = vi.fn()

    const d = onEmitter(emitter, 'data', handler)

    expect(emitter.listenerCount('data')).toBe(1)

    emitter.emit('data', 'hello')
    expect(handler).toHaveBeenCalledWith('hello')

    d.dispose()

    expect(emitter.listenerCount('data')).toBe(0)
  })
})
