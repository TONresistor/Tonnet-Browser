import { describe, expect, it, vi } from 'vitest'
import { DisposableStore } from '../../utils/disposable'
import { ViewRegistry } from '../view-registry'

function scope(dispose = vi.fn()): DisposableStore {
  const store = new DisposableStore()
  store.add({ dispose })
  return store
}

describe('ViewRegistry', () => {
  it('owns registered views and rejects duplicate tab identities', () => {
    const registry = new ViewRegistry<object>()
    const view = {}
    registry.add('tab-1', view, scope())
    expect(registry.get('tab-1')).toBe(view)
    expect(registry.size).toBe(1)
    expect(() => registry.add('tab-1', {}, scope())).toThrow('already registered')
  })

  it('only activates owned views', () => {
    const registry = new ViewRegistry<object>()
    const view = {}
    registry.add('tab-1', view, scope())
    expect(registry.activate('missing')).toBe(false)
    expect(registry.activeViewId).toBeNull()
    expect(registry.activate('tab-1')).toBe(true)
    expect(registry.getActive()).toBe(view)
  })

  it('disposes the listener scope exactly once when removing a view', () => {
    const dispose = vi.fn()
    const registry = new ViewRegistry<object>()
    registry.add('tab-1', {}, scope(dispose))
    registry.activate('tab-1')
    expect(registry.remove('tab-1')).not.toBeNull()
    expect(registry.remove('tab-1')).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
    expect(registry.activeViewId).toBeNull()
  })

  it('replaces a view while preserving active tab identity', () => {
    const dispose = vi.fn()
    const registry = new ViewRegistry<object>()
    const previous = {}
    const replacement = {}
    registry.add('tab-1', previous, scope(dispose))
    registry.activate('tab-1')
    expect(registry.replace('tab-1', replacement, scope())).toBe(previous)
    expect(registry.getActive()).toBe(replacement)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('disposes every scope and releases every reference on clear', () => {
    const first = vi.fn()
    const second = vi.fn()
    const registry = new ViewRegistry<object>()
    registry.add('tab-1', {}, scope(first))
    registry.add('tab-2', {}, scope(second))
    registry.activate('tab-2')
    expect(registry.clear()).toHaveLength(2)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(registry.size).toBe(0)
    expect(registry.activeViewId).toBeNull()
  })
})
