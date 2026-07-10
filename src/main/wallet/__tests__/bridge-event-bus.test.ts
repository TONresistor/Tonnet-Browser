import { describe, expect, it, vi } from 'vitest'
import { BridgeEventBus } from '../bridge-event-bus'

describe('BridgeEventBus', () => {
  it('subscribes, emits, and disposes one listener without affecting another', () => {
    const onError = vi.fn()
    const bus = new BridgeEventBus(onError)
    const first = vi.fn()
    const second = vi.fn()
    const disposeFirst = bus.on('transaction', first)
    bus.on('transaction', second)

    bus.emit('transaction', { id: 1 })
    disposeFirst()
    bus.emit('transaction', { id: 2 })

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    expect(bus.listenerCount('transaction')).toBe(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('isolates listener failures and continues delivery', () => {
    const onError = vi.fn()
    const bus = new BridgeEventBus(onError)
    const healthy = vi.fn()
    bus.on('event', () => {
      throw new Error('broken consumer')
    })
    bus.on('event', healthy)

    bus.emit('event', 'payload')

    expect(onError).toHaveBeenCalledWith('event', expect.any(Error))
    expect(healthy).toHaveBeenCalledWith('payload')
  })

  it('clears all listeners on lifecycle teardown', () => {
    const bus = new BridgeEventBus(vi.fn())
    bus.on('one', vi.fn())
    bus.on('two', vi.fn())
    bus.clear()
    expect(bus.listenerCount('one')).toBe(0)
    expect(bus.listenerCount('two')).toBe(0)
  })
})
